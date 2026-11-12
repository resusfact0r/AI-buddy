package fakeapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

type request struct {
	ID        int
	UserID    int
	Type      string
	Status    string
	Payload   map[string]any
	Comment   string
	CreatedAt time.Time
}

// Event — событие метрик, записанное агентом.
type Event struct {
	UserID  int
	Type    string
	Payload map[string]any
}

// Server — имитация API Бэкенда 1.
type Server struct {
	Now func() time.Time

	mu        sync.Mutex
	tasks     map[int]map[int]string    // user → task → status
	access    map[int]map[string]string // user → system → granted|requested
	requests  []*request
	idem      map[string]int
	chat      map[string][]map[string]any
	events    []Event
	failNext  int
	failReads int
	idemSeen  []string
	nextReqID int
	hits      map[string]int
}

// New создаёт сервер с сидами: у Анны часть задач выполнена, GitLab выдан, Jira запрошена.
func New() *Server {
	s := &Server{Now: time.Now, tasks: map[int]map[int]string{}, access: map[int]map[string]string{},
		idem: map[string]int{}, chat: map[string][]map[string]any{}, hits: map[string]int{}, nextReqID: 100}
	for _, u := range seedUsers {
		s.tasks[u.ID] = map[int]string{}
		s.access[u.ID] = map[string]string{}
	}
	for _, id := range []int{1, 2, 4} {
		s.tasks[1][id] = "done"
	}
	s.tasks[3][1] = "done"
	s.access[1]["gitlab"] = "granted"
	s.access[1]["jira"] = "requested"
	s.requests = append(s.requests, &request{ID: 100, UserID: 1, Type: "access", Status: "pending",
		Payload: map[string]any{"system": "jira", "reason": "Нужна для задач спринта"}, CreatedAt: time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC)})
	s.nextReqID = 101
	for _, sys := range []string{"gitlab", "jira", "storybook", "sentry"} {
		s.access[3][sys] = "granted"
	}
	return s
}

// Token возвращает тестовый токен пользователя (в реальном API это JWT).
func Token(login string) string { return "fake." + login + ".token" }

// FailNext заставляет следующие n обращений к «корпоративным сервисам» вернуть 503.
func (s *Server) FailNext(n int) { s.mu.Lock(); s.failNext = n; s.mu.Unlock() }

// Events возвращает записанные события.
func (s *Server) Events() []Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Event(nil), s.events...)
}

// Hits возвращает число обращений к маршруту вида "POST /requests/leave".
func (s *Server) Hits(route string) int { s.mu.Lock(); defer s.mu.Unlock(); return s.hits[route] }

// RequestCount возвращает число заявок заданного типа; status "" — любой статус.
func (s *Server) RequestCount(typ, status string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, r := range s.requests {
		if r.Type == typ && (status == "" || r.Status == status) {
			n++
		}
	}
	return n
}

// AccessStatus возвращает статус доступа пользователя к системе.
func (s *Server) AccessStatus(userID int, system string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.access[userID][system]
}

// FailReads заставляет следующие n запросов чтения (GET) вернуть 503.
func (s *Server) FailReads(n int) { s.mu.Lock(); s.failReads = n; s.mu.Unlock() }

// LastIdempotencyKeys возвращает ключи идемпотентности, с которыми приходили запросы.
func (s *Server) LastIdempotencyKeys() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.idemSeen...)
}

// TaskStatus возвращает статус задачи пользователя (для проверок в тестах).
func (s *Server) TaskStatus(userID, taskID int) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status(userID, taskID)
}

type apiErr struct {
	status    int
	code, msg string
	retryable bool
}

func fail(status int, code, msg string) *apiErr { return &apiErr{status: status, code: code, msg: msg} }

var (
	errForbidden = fail(403, "forbidden", "Недостаточно прав для этого действия")
	errNotFound  = fail(404, "not_found", "Не найдено")
)

type handler func(u user, r *http.Request) (any, *apiErr)

// Handler возвращает HTTP-обработчик API.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	write := func(w http.ResponseWriter, status int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(v)
	}
	writeErr := func(w http.ResponseWriter, e *apiErr) {
		body := map[string]any{"code": e.code, "message": e.msg}
		if e.retryable {
			body["retryable"] = true
		}
		write(w, e.status, map[string]any{"error": body})
	}
	route := func(pattern string, h handler) {
		parts := strings.SplitN(pattern, " ", 2)
		mux.HandleFunc(parts[0]+" /api/v1"+parts[1], func(w http.ResponseWriter, r *http.Request) {
			u, ok := s.auth(r)
			if !ok {
				writeErr(w, fail(401, "unauthorized", "Требуется авторизация"))
				return
			}
			s.mu.Lock()
			s.hits[pattern]++
			if k := r.Header.Get("Idempotency-Key"); k != "" {
				s.idemSeen = append(s.idemSeen, k)
			}
			var res any
			var e *apiErr
			if r.Method == http.MethodGet && s.failReads > 0 && !strings.HasPrefix(parts[1], "/auth") {
				s.failReads--
				e = errUpstream
			} else {
				res, e = h(u, r)
			}
			s.mu.Unlock()
			if e != nil {
				writeErr(w, e)
				return
			}
			write(w, 200, res)
		})
	}
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { write(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("POST /api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Login, Password string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		for _, u := range seedUsers {
			if u.Login == in.Login && in.Password == "test1234" {
				write(w, 200, map[string]any{"access_token": Token(u.Login), "user": userJSON(u)})
				return
			}
		}
		writeErr(w, fail(401, "unauthorized", "Неверный логин или пароль"))
	})
	route("GET /auth/me", func(u user, _ *http.Request) (any, *apiErr) { return userJSON(u), nil })
	route("GET /me/profile", func(u user, _ *http.Request) (any, *apiErr) {
		t := teamByID(u.TeamID)
		p := map[string]any{"user": userJSON(u), "team": map[string]any{"id": t.ID, "name": t.Name}}
		if b, ok := userByID(u.BuddyID); ok {
			p["buddy"] = personJSON(b)
		}
		if l, ok := userByID(u.LeadID); ok {
			p["lead"] = personJSON(l)
		}
		return p, nil
	})
	route("GET /teams/{id}", func(u user, r *http.Request) (any, *apiErr) {
		id, _ := strconv.Atoi(r.PathValue("id"))
		if id != u.TeamID {
			return nil, errForbidden
		}
		t := teamByID(id)
		var tools []map[string]any
		for _, sys := range t.Systems {
			tools = append(tools, map[string]any{"system": sys.Code, "title": sys.Title, "purpose": sys.Purpose, "required": sys.Required})
		}
		return map[string]any{"id": t.ID, "name": t.Name, "description": t.Description, "standup": t.Standup,
			"docs_url": t.DocsURL, "channels": t.Channels, "rules": t.Rules, "tools": tools, "is_test_data": true}, nil
	})
	route("GET /people", func(u user, r *http.Request) (any, *apiErr) {
		q := stems(r.URL.Query().Get("query"))
		items := []map[string]any{}
		for _, p := range seedUsers {
			if p.TeamID != u.TeamID {
				continue
			}
			if matchAll(q, p.FullName+" "+p.Role+" "+p.Resp+" "+roleRu(p.Role)) {
				items = append(items, personJSON(p))
			}
		}
		return map[string]any{"items": items}, nil
	})
	route("GET /onboarding/plan", func(u user, r *http.Request) (any, *apiErr) {
		target, e := s.target(u, r)
		if e != nil {
			return nil, e
		}
		return s.plan(target), nil
	})
	route("GET /onboarding/progress", func(u user, r *http.Request) (any, *apiErr) {
		target, e := s.target(u, r)
		if e != nil {
			return nil, e
		}
		return s.progress(target), nil
	})
	route("GET /onboarding/next-steps", func(u user, r *http.Request) (any, *apiErr) {
		target, e := s.target(u, r)
		if e != nil {
			return nil, e
		}
		cur := s.currentStage(target)
		items := []map[string]any{}
		for _, t := range seedTasks {
			if t.Stage == cur && t.Required && s.status(target, t.ID) != "done" && len(items) < 3 {
				items = append(items, s.taskJSON(target, t))
			}
		}
		return map[string]any{"items": items}, nil
	})
	route("PATCH /onboarding/tasks/{id}", func(u user, r *http.Request) (any, *apiErr) {
		if u.Role != "intern" {
			return nil, errForbidden
		}
		id, _ := strconv.Atoi(r.PathValue("id"))
		var in struct{ Status, Comment string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		for _, t := range seedTasks {
			if t.ID != id {
				continue
			}
			if t.Code == "get_access" {
				return nil, fail(409, "conflict", "Задача «Получить доступы» закрывается автоматически, когда выданы все обязательные доступы")
			}
			switch in.Status {
			case "todo", "in_progress", "done", "blocked":
			default:
				return nil, fail(400, "validation_error", "Недопустимый статус")
			}
			s.tasks[u.ID][id] = in.Status
			return s.taskJSON(u.ID, t), nil
		}
		return nil, errNotFound
	})
	route("GET /knowledge/search", func(u user, r *http.Request) (any, *apiErr) {
		q := stems(r.URL.Query().Get("query"))
		type hit struct {
			a    article
			rank int
		}
		var hits []hit
		for _, a := range seedArticles {
			if a.TeamID != 0 && a.TeamID != u.TeamID {
				continue
			}
			if len(q) == 0 || !matchAll(q, a.Title+" "+a.Body+" "+strings.Join(a.Tags, " ")) {
				continue
			}
			rank := 1
			if matchAll(q, a.Title+" "+strings.Join(a.Tags, " ")) {
				rank = 3
			}
			if a.TeamID != 0 {
				rank++
			}
			hits = append(hits, hit{a, rank})
		}
		sort.SliceStable(hits, func(i, j int) bool { return hits[i].rank > hits[j].rank })
		items := []map[string]any{}
		for _, h := range hits {
			snippet := []rune(h.a.Body)
			if len(snippet) > 160 {
				snippet = append(snippet[:160], '…')
			}
			items = append(items, map[string]any{"id": h.a.ID, "title": h.a.Title, "snippet": string(snippet), "rank": h.rank})
		}
		return map[string]any{"items": items}, nil
	})
	route("GET /knowledge/{id}", func(u user, r *http.Request) (any, *apiErr) {
		id, _ := strconv.Atoi(r.PathValue("id"))
		for _, a := range seedArticles {
			if a.ID == id && (a.TeamID == 0 || a.TeamID == u.TeamID) {
				return map[string]any{"id": a.ID, "title": a.Title, "body": a.Body, "tags": a.Tags, "is_test_data": true}, nil
			}
		}
		return nil, errNotFound
	})
	route("GET /access/overview", func(u user, _ *http.Request) (any, *apiErr) {
		systems := []map[string]any{}
		for _, sys := range teamByID(u.TeamID).Systems {
			st := s.access[u.ID][sys.Code]
			if st == "" {
				st = "missing"
			}
			systems = append(systems, map[string]any{"system": sys.Code, "title": sys.Title, "purpose": sys.Purpose, "required": sys.Required, "status": st})
		}
		return map[string]any{"systems": systems}, nil
	})
	route("POST /requests/leave", s.createLeave)
	route("POST /requests/access", s.createAccess)
	route("GET /requests", func(u user, r *http.Request) (any, *apiErr) {
		items := []map[string]any{}
		for _, rq := range s.requests {
			if rq.UserID != u.ID {
				continue
			}
			if t := r.URL.Query().Get("type"); t != "" && t != rq.Type {
				continue
			}
			if st := r.URL.Query().Get("status"); st != "" && st != rq.Status {
				continue
			}
			items = append(items, s.requestJSON(rq))
		}
		return map[string]any{"items": items}, nil
	})
	route("GET /requests/{id}", func(u user, r *http.Request) (any, *apiErr) {
		rq := s.findRequest(r.PathValue("id"))
		if rq == nil {
			return nil, errNotFound
		}
		owner, _ := userByID(rq.UserID)
		if rq.UserID != u.ID && !(u.Role == "lead" && owner.TeamID == u.TeamID) {
			return nil, errNotFound
		}
		return s.requestJSON(rq), nil
	})
	route("GET /approvals/pending", func(u user, _ *http.Request) (any, *apiErr) {
		if u.Role != "lead" {
			return nil, errForbidden
		}
		items := []map[string]any{}
		for _, rq := range s.requests {
			owner, _ := userByID(rq.UserID)
			if rq.Status == "pending" && owner.TeamID == u.TeamID && rq.UserID != u.ID {
				items = append(items, s.requestJSON(rq))
			}
		}
		return map[string]any{"items": items}, nil
	})
	route("POST /requests/{id}/approve", func(u user, r *http.Request) (any, *apiErr) { return s.decide(u, r, "approved") })
	route("POST /requests/{id}/reject", func(u user, r *http.Request) (any, *apiErr) { return s.decide(u, r, "rejected") })
	route("GET /chat/history", func(u user, r *http.Request) (any, *apiErr) {
		key := fmt.Sprint(u.ID, ":", r.URL.Query().Get("conversation_id"))
		items := s.chat[key]
		if items == nil {
			items = []map[string]any{}
		}
		return map[string]any{"items": items}, nil
	})
	route("POST /chat/messages", func(u user, r *http.Request) (any, *apiErr) {
		var in map[string]any
		_ = json.NewDecoder(r.Body).Decode(&in)
		key := fmt.Sprint(u.ID, ":", in["conversation_id"])
		s.chat[key] = append(s.chat[key], in)
		return map[string]any{"ok": true}, nil
	})
	route("POST /events", func(u user, r *http.Request) (any, *apiErr) {
		var in struct {
			Type    string
			Payload map[string]any
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		s.events = append(s.events, Event{UserID: u.ID, Type: in.Type, Payload: in.Payload})
		return map[string]any{"ok": true}, nil
	})
	return mux
}

func (s *Server) auth(r *http.Request) (user, bool) {
	tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	for _, u := range seedUsers {
		if tok == Token(u.Login) {
			return u, true
		}
	}
	return user{}, false
}

// target определяет, чьи данные запрошены, и проверяет права (свой / подопечный / своя команда).
func (s *Server) target(u user, r *http.Request) (int, *apiErr) {
	raw := r.URL.Query().Get("user_id")
	if raw == "" {
		return u.ID, nil
	}
	id, _ := strconv.Atoi(raw)
	t, ok := userByID(id)
	if !ok {
		return 0, errForbidden
	}
	switch {
	case id == u.ID:
	case u.Role == "buddy" && t.BuddyID == u.ID:
	case u.Role == "lead" && t.TeamID == u.TeamID:
	default:
		return 0, errForbidden
	}
	return id, nil
}

func (s *Server) status(uid, tid int) string {
	if st := s.tasks[uid][tid]; st != "" {
		return st
	}
	return "todo"
}

func (s *Server) taskJSON(uid int, t task) map[string]any {
	return map[string]any{"id": t.ID, "code": t.Code, "title": t.Title, "description": t.Desc, "link": t.Link,
		"required": t.Required, "status": s.status(uid, t.ID), "stage": stageTitles[t.Stage-1]}
}

func (s *Server) currentStage(uid int) int {
	for _, t := range seedTasks {
		if t.Required && s.status(uid, t.ID) != "done" {
			return t.Stage
		}
	}
	return len(stageTitles)
}

func (s *Server) plan(uid int) map[string]any {
	stages := []map[string]any{}
	for i, title := range stageTitles {
		tasks := []map[string]any{}
		for _, t := range seedTasks {
			if t.Stage == i+1 {
				tasks = append(tasks, s.taskJSON(uid, t))
			}
		}
		stages = append(stages, map[string]any{"id": i + 1, "order": i + 1, "title": title, "tasks": tasks})
	}
	return map[string]any{"stages": stages}
}

func (s *Server) progress(uid int) map[string]any {
	total, done := 0, 0
	stages := []map[string]any{}
	for i, title := range stageTitles {
		st, sd := 0, 0
		for _, t := range seedTasks {
			if t.Stage == i+1 {
				st++
				if s.status(uid, t.ID) == "done" {
					sd++
				}
			}
		}
		total, done = total+st, done+sd
		stages = append(stages, map[string]any{"id": i + 1, "title": title, "percent": sd * 100 / st})
	}
	cur := s.currentStage(uid)
	return map[string]any{"percent": done * 100 / total, "stages": stages,
		"current_stage": map[string]any{"id": cur, "title": stageTitles[cur-1]}}
}

func (s *Server) corpFails(r *http.Request) bool {
	if r.Header.Get("X-Mock-Fail") == "true" {
		return true
	}
	if s.failNext > 0 {
		s.failNext--
		return true
	}
	return false
}

var errUpstream = &apiErr{status: 503, code: "upstream_unavailable", msg: "Корпоративный сервис временно недоступен", retryable: true}

func (s *Server) createLeave(u user, r *http.Request) (any, *apiErr) {
	var in struct {
		DateFrom   string `json:"date_from"`
		DateTo     string `json:"date_to"`
		ReasonType string `json:"reason_type"`
		Comment    string `json:"comment"`
	}
	_ = json.NewDecoder(r.Body).Decode(&in)
	key := r.Header.Get("Idempotency-Key")
	if id, ok := s.idem[key]; ok && key != "" {
		return s.requestJSON(s.findRequest(strconv.Itoa(id))), nil
	}
	from, e1 := time.Parse("2006-01-02", in.DateFrom)
	to, e2 := time.Parse("2006-01-02", in.DateTo)
	today := s.Now().UTC().Truncate(24 * time.Hour)
	switch {
	case e1 != nil || e2 != nil:
		return nil, fail(400, "validation_error", "Даты должны быть в формате ГГГГ-ММ-ДД")
	case from.Before(today):
		return nil, fail(400, "validation_error", "Дата начала не может быть в прошлом")
	case to.Before(from):
		return nil, fail(400, "validation_error", "Дата окончания раньше даты начала")
	case to.Sub(from) > 13*24*time.Hour:
		return nil, fail(400, "validation_error", "Отгул не может быть длиннее 14 дней")
	}
	for _, rq := range s.requests {
		if rq.UserID != u.ID || rq.Type != "leave" || (rq.Status != "pending" && rq.Status != "approved") {
			continue
		}
		rf, _ := time.Parse("2006-01-02", fmt.Sprint(rq.Payload["date_from"]))
		rt, _ := time.Parse("2006-01-02", fmt.Sprint(rq.Payload["date_to"]))
		if !from.After(rt) && !to.Before(rf) {
			return nil, fail(409, "conflict", "На эти даты уже есть активная заявка")
		}
	}
	rq := &request{ID: s.nextReqID, UserID: u.ID, Type: "leave", Status: "pending", CreatedAt: s.Now(),
		Payload: map[string]any{"date_from": in.DateFrom, "date_to": in.DateTo, "reason_type": in.ReasonType, "comment": in.Comment}}
	s.nextReqID++
	if s.corpFails(r) {
		rq.Status = "failed"
		s.requests = append(s.requests, rq)
		return nil, errUpstream
	}
	s.requests = append(s.requests, rq)
	if key != "" {
		s.idem[key] = rq.ID
	}
	return s.requestJSON(rq), nil
}

func (s *Server) createAccess(u user, r *http.Request) (any, *apiErr) {
	var in struct {
		System     string
		SystemCode string `json:"system_code"`
		Reason     string
	}
	_ = json.NewDecoder(r.Body).Decode(&in)
	if in.SystemCode != "" {
		in.System = in.SystemCode
	}
	key := r.Header.Get("Idempotency-Key")
	if id, ok := s.idem[key]; ok && key != "" {
		return s.requestJSON(s.findRequest(strconv.Itoa(id))), nil
	}
	found := false
	for _, sys := range teamByID(u.TeamID).Systems {
		found = found || sys.Code == in.System
	}
	if !found {
		return nil, fail(400, "validation_error", "Система не входит в набор инструментов твоей команды")
	}
	if st := s.access[u.ID][in.System]; st != "" {
		return nil, fail(409, "conflict", "Доступ к этой системе уже выдан или запрошен")
	}
	if s.corpFails(r) {
		return nil, errUpstream
	}
	rq := &request{ID: s.nextReqID, UserID: u.ID, Type: "access", Status: "pending", CreatedAt: s.Now(),
		Payload: map[string]any{"system": in.System, "reason": in.Reason}}
	s.nextReqID++
	s.requests = append(s.requests, rq)
	s.access[u.ID][in.System] = "requested"
	if key != "" {
		s.idem[key] = rq.ID
	}
	return s.requestJSON(rq), nil
}

func (s *Server) decide(u user, r *http.Request, status string) (any, *apiErr) {
	rq := s.findRequest(r.PathValue("id"))
	if rq == nil {
		return nil, errNotFound
	}
	owner, _ := userByID(rq.UserID)
	if u.Role != "lead" || owner.TeamID != u.TeamID || rq.UserID == u.ID {
		return nil, errForbidden
	}
	if rq.Status == status {
		return s.requestJSON(rq), nil
	}
	if rq.Status != "pending" {
		return nil, fail(409, "conflict", "Заявка уже обработана")
	}
	var in struct{ Comment string }
	_ = json.NewDecoder(r.Body).Decode(&in)
	rq.Status, rq.Comment = status, in.Comment
	if rq.Type == "access" {
		sys := fmt.Sprint(rq.Payload["system"])
		if status == "approved" {
			s.access[rq.UserID][sys] = "granted"
			all := true
			for _, sy := range teamByID(owner.TeamID).Systems {
				if sy.Required && s.access[rq.UserID][sy.Code] != "granted" {
					all = false
				}
			}
			if all {
				s.tasks[rq.UserID][6] = "done"
			}
		} else {
			delete(s.access[rq.UserID], sys)
		}
	}
	return s.requestJSON(rq), nil
}

func (s *Server) findRequest(id string) *request {
	n, _ := strconv.Atoi(id)
	for _, rq := range s.requests {
		if rq.ID == n {
			return rq
		}
	}
	return nil
}

func (s *Server) requestJSON(rq *request) map[string]any {
	owner, _ := userByID(rq.UserID)
	out := map[string]any{"id": rq.ID, "type": rq.Type, "status": rq.Status, "payload": rq.Payload,
		"user":       map[string]any{"id": owner.ID, "full_name": owner.FullName},
		"created_at": rq.CreatedAt.Format(time.RFC3339), "external_id": fmt.Sprintf("corp-%d", rq.ID)}
	if l, ok := userByID(owner.LeadID); ok {
		out["approver"] = map[string]any{"id": l.ID, "full_name": l.FullName}
	}
	if rq.Comment != "" {
		out["decision_comment"] = rq.Comment
	}
	return out
}

func userJSON(u user) map[string]any {
	return map[string]any{"id": u.ID, "login": u.Login, "full_name": u.FullName, "role": u.Role, "team_id": u.TeamID}
}

func personJSON(u user) map[string]any {
	return map[string]any{"id": u.ID, "full_name": u.FullName, "role": u.Role, "responsibility": u.Resp, "contact": u.Contact}
}

func userByID(id int) (user, bool) {
	for _, u := range seedUsers {
		if u.ID == id {
			return u, true
		}
	}
	return user{}, false
}

func teamByID(id int) team {
	for _, t := range seedTeams {
		if t.ID == id {
			return t
		}
	}
	return team{}
}

func roleRu(role string) string {
	switch role {
	case "intern":
		return "стажёр"
	case "buddy":
		return "наставник бадди"
	case "lead":
		return "руководитель лид"
	}
	return role
}

// stems — грубая имитация русской морфологии tsvector: слова сравниваются по первым 5 буквам.
func stems(text string) []string {
	var out []string
	for _, w := range strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		r := []rune(strings.ReplaceAll(w, "ё", "е"))
		if len(r) < 2 {
			continue
		}
		if len(r) > 5 {
			r = r[:5]
		}
		out = append(out, string(r))
	}
	return out
}

func matchAll(query []string, text string) bool {
	have := stems(text)
	for _, q := range query {
		found := false
		for _, st := range have {
			if strings.HasPrefix(st, q) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
