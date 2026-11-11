package httpapi

import (
	"aibuddy/backend/internal/auth"
	"aibuddy/backend/internal/domain"
	"aibuddy/backend/internal/rbac"
	"aibuddy/backend/internal/service"
	"aibuddy/backend/internal/storage"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type API struct {
	Store   *storage.Store
	Service *service.Service
	Redis   *redis.Client
	Secret  string
}

func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func failure(w http.ResponseWriter, e error) {
	var de *domain.Error
	if !errors.As(e, &de) {
		slog.Error("request failed", "error", e)
		de = domain.Err(500, "internal_error", "Внутренняя ошибка")
	}
	write(w, de.Status, map[string]any{"error": de})
}
func decode(r *http.Request, v any) error {
	d := json.NewDecoder(io.LimitReader(r.Body, 65537))
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return domain.Err(400, "validation_error", "Некорректный JSON")
	}
	if d.Decode(new(any)) != io.EOF {
		return domain.Err(400, "validation_error", "Ожидается один JSON объект")
	}
	return nil
}
func (a *API) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	id := service.ID()
	w.Header().Set("X-Request-ID", id)
	start := time.Now()
	uid := ""
	defer func() {
		slog.Info("request", "request_id", id, "user_id", uid, "method", r.Method, "path", r.URL.Path, "duration_ms", time.Since(start).Milliseconds())
	}()
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	path := strings.TrimPrefix(r.URL.Path, "/api/v1")
	if r.Method == "GET" && (path == "/healthz" || path == "/readyz") {
		if path == "/readyz" {
			if e := a.Store.DB.Ping(ctx); e != nil {
				failure(w, domain.Err(503, "unavailable", "База недоступна"))
				return
			}
			if e := a.Redis.Ping(ctx).Err(); e != nil {
				failure(w, domain.Err(503, "unavailable", "Redis недоступен"))
				return
			}
		}
		write(w, 200, map[string]string{"status": "ok"})
		return
	}
	if r.URL.Path == "/api/v1/auth/login" && r.Method == "POST" {
		a.login(w, r)
		return
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	var e error
	uid, e = auth.Verify(token, a.Secret, time.Now())
	if e != nil {
		failure(w, domain.Err(401, "unauthorized", "Требуется авторизация"))
		return
	}
	u, e := a.Store.User(ctx, uid)
	if e != nil {
		failure(w, domain.Err(401, "unauthorized", "Неизвестный пользователь"))
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/api/v1/") {
		failure(w, domain.Err(404, "not_found", "Маршрут не найден"))
		return
	}
	if r.Method != "GET" || strings.HasPrefix(path, "/requests/") {
		conn, err := a.Store.DB.Acquire(ctx)
		if err != nil {
			failure(w, err)
			return
		}
		defer conn.Release()
		var locked bool
		if err = conn.QueryRow(ctx, "SELECT pg_try_advisory_lock(814422)").Scan(&locked); err != nil {
			failure(w, err)
			return
		}
		if !locked {
			failure(w, domain.Err(409, "conflict", "Another mutation is in progress; retry with the same key"))
			return
		}
		defer func() {
			unlock, c := context.WithTimeout(context.Background(), 2*time.Second)
			defer c()
			_, _ = conn.Exec(unlock, "SELECT pg_advisory_unlock(814422)")
		}()
	}
	var out any
	status := 200
	switch {
	case path == "/auth/me" && r.Method == "GET":
		out = u
	case path == "/me/profile" && r.Method == "GET":
		var t domain.Team
		e = a.Store.Get(ctx, "teams", u.TeamID, &t)
		buddy, _ := a.Store.User(ctx, u.BuddyID)
		lead, _ := a.Store.User(ctx, u.LeadID)
		out = map[string]any{"user": u, "team": t, "buddy": buddy, "lead": lead, "is_test_data": true}
	case strings.HasPrefix(path, "/teams/") && r.Method == "GET":
		tid := strings.TrimPrefix(path, "/teams/")
		if !rbac.Can(u, "team", domain.Resource{TeamID: tid}) {
			e = domain.Err(403, "forbidden", "Нет доступа к команде")
			break
		}
		var t domain.Team
		if !a.cached(ctx, "team:"+tid, &t) {
			e = a.Store.Get(ctx, "teams", tid, &t)
			if e == nil {
				a.cache(ctx, "team:"+tid, t)
			}
		}
		out = t
	case strings.HasPrefix(path, "/onboarding/") && r.Method == "GET":
		var p []domain.Stage
		target := r.URL.Query().Get("user_id")
		if target == "" {
			target = u.ID
		}
		owner, err := a.Store.User(ctx, target)
		if err != nil {
			e = domain.Err(404, "not_found", "Пользователь не найден")
			break
		}
		if !rbac.Can(u, "plan", service.Resource(owner)) {
			e = domain.Err(403, "forbidden", "Нет доступа к плану")
			break
		}
		var version string
		e = a.Store.DB.QueryRow(ctx, "SELECT md5(data::text) FROM user_plans_api WHERE user_id=$1", target).Scan(&version)
		if e != nil {
			break
		}
		key := "plan:" + target + ":" + version
		if !a.cached(ctx, key, &p) {
			p, e = a.Service.Plan(ctx, u, target)
			if e == nil {
				a.cache(ctx, key, p)
			}
		}
		if e != nil {
			break
		}
		switch path {
		case "/onboarding/plan":
			out = map[string]any{"stages": p, "is_test_data": true}
		case "/onboarding/progress":
			out = service.Progress(p)
		case "/onboarding/next-steps":
			out = map[string]any{"tasks": service.Progress(p)["next_steps"]}
		default:
			e = domain.Err(404, "not_found", "Маршрут не найден")
		}
	case strings.HasPrefix(path, "/onboarding/tasks/") && r.Method == "PATCH":
		var b struct {
			Status  string `json:"status"`
			Comment string `json:"comment"`
		}
		e = decode(r, &b)
		if e == nil {
			e = a.Service.Task(ctx, u, strings.TrimPrefix(path, "/onboarding/tasks/"), b.Status, b.Comment)
		}
		out = map[string]bool{"updated": true}
	case path == "/access/overview" && r.Method == "GET":
		out, e = a.Service.Overview(ctx, u)
	case (path == "/requests/leave" || path == "/requests/access") && r.Method == "POST":
		a.create(w, r, u, strings.TrimPrefix(path, "/requests/"))
		return
	case (path == "/requests" || path == "/approvals/pending") && r.Method == "GET":
		if path == "/approvals/pending" && !rbac.Can(u, "pending", service.Resource(u)) {
			e = domain.Err(403, "forbidden", "Только руководитель")
			break
		}
		var list []domain.Request
		list, e = a.Service.Visible(ctx, u)
		filtered := []domain.Request{}
		for _, v := range list {
			if path == "/approvals/pending" && (v.Status != "pending" || v.UserID == u.ID) {
				continue
			}
			if q := r.URL.Query().Get("type"); q != "" && v.Type != q {
				continue
			}
			if q := r.URL.Query().Get("status"); q != "" && v.Status != q {
				continue
			}
			filtered = append(filtered, v)
		}
		out = filtered
	case strings.HasPrefix(path, "/requests/"):
		parts := strings.Split(strings.TrimPrefix(path, "/requests/"), "/")
		if len(parts) == 1 && r.Method == "GET" {
			out, e = a.Service.Sync(ctx, u, parts[0])
		} else if len(parts) == 2 && r.Method == "POST" && (parts[1] == "approve" || parts[1] == "reject") {
			var b struct {
				Comment string `json:"comment"`
			}
			e = decode(r, &b)
			if e == nil {
				decision := "approved"
				if parts[1] == "reject" {
					decision = "rejected"
				}
				out, e = a.Service.Decision(ctx, u, parts[0], decision, b.Comment, r.Header.Get("X-Mock-Fail") == "true")
			}
		} else {
			e = domain.Err(404, "not_found", "Маршрут не найден")
		}
	case path == "/knowledge/search" && r.Method == "GET":
		out, e = a.search(r, u)
	case strings.HasPrefix(path, "/knowledge/") && r.Method == "GET":
		var v domain.Article
		e = a.Store.Get(ctx, "knowledge_articles", strings.TrimPrefix(path, "/knowledge/"), &v)
		if e != nil {
			e = domain.Err(404, "not_found", "Статья не найдена")
		} else if !rbac.Can(u, "knowledge", domain.Resource{TeamID: v.TeamID}) {
			e = domain.Err(403, "forbidden", "Нет доступа к статье")
		}
		out = v
	case path == "/events" && r.Method == "POST":
		var b struct {
			Type    string         `json:"type"`
			Payload map[string]any `json:"payload"`
		}
		e = decode(r, &b)
		if e == nil && strings.TrimSpace(b.Type) == "" {
			e = domain.Err(400, "validation_error", "Нужен type")
		}
		if e == nil {
			data, _ := json.Marshal(b)
			_, e = a.Store.DB.Exec(ctx, "INSERT INTO events(user_id,data) VALUES($1,$2)", u.ID, data)
		}
		status = 201
		out = map[string]bool{"saved": true}
	case path == "/chat/messages" && r.Method == "POST":
		var b struct {
			ConversationID string         `json:"conversation_id"`
			Role           string         `json:"role"`
			Content        string         `json:"content"`
			Meta           map[string]any `json:"meta"`
		}
		e = decode(r, &b)
		if e == nil && (b.ConversationID == "" || len(b.Content) > 16000 || (b.Role != "user" && b.Role != "assistant" && b.Role != "tool")) {
			e = domain.Err(400, "validation_error", "Некорректное сообщение")
		}
		var messageID int64
		if e == nil {
			data, _ := json.Marshal(b)
			e = a.Store.DB.QueryRow(ctx, "INSERT INTO chat_messages(user_id,conversation_id,data) VALUES($1,$2,$3) RETURNING id", u.ID, b.ConversationID, data).Scan(&messageID)
		}
		out = map[string]any{"id": messageID}
		status = 201
	case path == "/chat/history" && r.Method == "GET":
		out, e = a.history(r, u)
	default:
		e = domain.Err(404, "not_found", "Маршрут не найден")
	}
	if e != nil {
		failure(w, e)
		return
	}
	write(w, status, out)
}
func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if e := decode(r, &b); e != nil {
		failure(w, e)
		return
	}
	key := fmt.Sprintf("login:%x", sha256.Sum256([]byte(b.Login)))
	n, e := a.Redis.Eval(r.Context(), `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n`, []string{key}).Int()
	if e != nil {
		failure(w, domain.Err(503, "unavailable", "Redis недоступен"))
		return
	}
	if n > 10 {
		failure(w, domain.Err(429, "rate_limited", "Слишком много попыток"))
		return
	}
	var id string
	e = a.Store.DB.QueryRow(r.Context(), "SELECT id FROM users WHERE login=$1", b.Login).Scan(&id)
	u, err := a.Store.User(r.Context(), id)
	if e != nil || err != nil || bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(b.Password)) != nil {
		failure(w, domain.Err(401, "unauthorized", "Неверные учётные данные"))
		return
	}
	write(w, 200, map[string]any{"access_token": auth.Issue(u.ID, a.Secret, time.Now()), "user": u})
}
func (a *API) create(w http.ResponseWriter, r *http.Request, u domain.User, kind string) {
	key := r.Header.Get("Idempotency-Key")
	if key == "" || len(key) > 200 {
		failure(w, domain.Err(400, "validation_error", "Нужен Idempotency-Key до 200 символов"))
		return
	}
	var p map[string]string
	if e := decode(r, &p); e != nil {
		failure(w, e)
		return
	}
	body, _ := json.Marshal(p)
	hash := fmt.Sprintf("%x", sha256.Sum256(append([]byte(kind), body...)))
	redisKey := "idem:" + u.ID + ":" + key
	var cached struct {
		Hash     string          `json:"hash"`
		Response json.RawMessage `json:"response"`
	}
	if a.cached(r.Context(), redisKey, &cached) && cached.Hash != "" {
		if cached.Hash != hash {
			failure(w, domain.Err(409, "conflict", "Idempotency key has a different payload"))
			return
		}
		write(w, 200, cached.Response)
		return
	}
	var oldhash string
	var response []byte
	e := a.Store.DB.QueryRow(r.Context(), "SELECT body_hash,response FROM idempotency WHERE user_id=$1 AND key=$2 AND created_at>now()-interval '24 hours'", u.ID, key).Scan(&oldhash, &response)
	if e == nil {
		if oldhash != hash {
			failure(w, domain.Err(409, "conflict", "Ключ уже использован с другим телом"))
			return
		}
		var v any
		_ = json.Unmarshal(response, &v)
		write(w, 200, v)
		return
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		failure(w, e)
		return
	}
	svc := *a.Service
	svc.RequestID = fmt.Sprintf("%x", sha256.Sum256([]byte(u.ID+":"+key+":"+hash)))
	svc.Repo = &idemRepository{Store: a.Store, key: key, hash: hash}
	req, e := svc.Create(r.Context(), u, kind, p, r.Header.Get("X-Mock-Fail") == "true")
	if e != nil {
		failure(w, e)
		return
	}
	response, _ = json.Marshal(req)
	cached.Hash = hash
	cached.Response = response
	encoded, _ := json.Marshal(cached)
	_ = a.Redis.Set(r.Context(), redisKey, encoded, 24*time.Hour).Err()
	write(w, 201, req)
}
func limit(r *http.Request, def int) int {
	n, e := strconv.Atoi(r.URL.Query().Get("limit"))
	if e != nil || n < 1 {
		return def
	}
	if n > 100 {
		return 100
	}
	return n
}
func (a *API) search(r *http.Request, u domain.User) (any, error) {
	q := r.URL.Query().Get("query")
	if strings.TrimSpace(q) == "" {
		return nil, domain.Err(400, "validation_error", "Нужен query")
	}
	rows, e := a.Store.DB.Query(r.Context(), `SELECT id,title,ts_headline('russian',body,plainto_tsquery('russian',$1)),team_id,ts_rank(tsv,plainto_tsquery('russian',$1)) FROM knowledge_articles WHERE (team_id IS NULL OR team_id=$2) AND tsv @@ plainto_tsquery('russian',$1) ORDER BY 5 DESC,id LIMIT $3`, q, u.TeamID, limit(r, 5))
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, title, snippet string
		var team *string
		var rank float32
		if e = rows.Scan(&id, &title, &snippet, &team, &rank); e != nil {
			return nil, e
		}
		out = append(out, map[string]any{"id": id, "title": title, "snippet": snippet, "team_id": team, "rank": rank, "is_test_data": true})
	}
	return out, rows.Err()
}
func (a *API) history(r *http.Request, u domain.User) (any, error) {
	rows, e := a.Store.DB.Query(r.Context(), "SELECT data FROM (SELECT id,data FROM chat_messages WHERE user_id=$1 AND conversation_id=$2 ORDER BY id DESC LIMIT $3) t ORDER BY id", u.ID, r.URL.Query().Get("conversation_id"), limit(r, 20))
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var b []byte
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		out = append(out, json.RawMessage(b))
	}
	return out, rows.Err()
}
