package orchestrator

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"

	"ai-buddy/agent/internal/apiclient"
	"ai-buddy/agent/internal/jsonx"
	"ai-buddy/agent/internal/llm"
	"ai-buddy/agent/internal/mcpclient"
)

type identEntry struct {
	id  Identity
	exp time.Time
}

// Identify проверяет JWT через GET /auth/me Бэкенда 1 и возвращает пользователя (кэш 60 с).
// Агент сам токены не разбирает и не подписывает.
func (o *Orchestrator) Identify(ctx context.Context, token string) (Identity, error) {
	sum := sha256.Sum256([]byte(token))
	key := hex.EncodeToString(sum[:])
	o.idMu.Lock()
	e, ok := o.idents[key]
	o.idMu.Unlock()
	if ok && o.Now().Before(e.exp) {
		return e.id, nil
	}
	ctx, cancel := context.WithTimeout(ctx, o.Cfg.ToolTimeout)
	defer cancel()
	raw, err := o.API.Me(ctx, token)
	if err != nil {
		return Identity{}, err
	}
	me := jsonx.Object(jsonx.Parse(raw))
	if u := jsonx.Get(me, "user"); len(u) > 0 {
		me = u
	}
	id := Identity{ID: jsonx.Str(me, "id"), Name: jsonx.Str(me, "full_name", "name"), Role: jsonx.Str(me, "role")}
	if id.ID == "" {
		return Identity{}, &apiclient.Error{Status: 401, Code: apiclient.CodeUnauthorized}
	}
	o.idMu.Lock()
	if len(o.idents) > 10000 {
		o.idents = map[string]identEntry{}
	}
	o.idents[key] = identEntry{id: id, exp: o.Now().Add(time.Minute)}
	o.idMu.Unlock()
	return id, nil
}

// Allow — rate limit на пользователя.
func (o *Orchestrator) Allow(ctx context.Context, id Identity) bool {
	ok, err := o.Store.Allow(ctx, "chat:"+id.ID, o.Cfg.RateLimit, o.Cfg.RateWindow)
	if err != nil {
		o.Log.Warn("rate limit unavailable", "err", err.Error())
		return true
	}
	return ok
}

// userContext собирает контекст пользователя для промпта: профиль и этап адаптации (через MCP).
func (o *Orchestrator) userContext(ctx context.Context, sess mcpclient.Session, id Identity) llm.UserContext {
	uc := llm.UserContext{Today: o.Now(), Name: id.Name, Role: id.Role}
	var profile, progress mcpclient.Result
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); profile = sess.Call(ctx, "get_my_profile", nil, "") }()
	go func() { defer wg.Done(); progress = sess.Call(ctx, "get_onboarding_progress", nil, "") }()
	wg.Wait()
	if !profile.IsError {
		p := jsonx.Object(jsonx.Parse([]byte(profile.Text)))
		uc.Team = jsonx.Str(jsonx.Get(p, "team"), "name")
		if uc.Team == "" {
			uc.Team = jsonx.Str(p, "team", "team_name")
		}
		uc.BuddyName = jsonx.Str(jsonx.Get(p, "buddy"), "full_name", "name")
		uc.LeadName = jsonx.Str(jsonx.Get(p, "lead"), "full_name", "name")
		if uc.Name == "" {
			uc.Name = jsonx.Str(jsonx.Get(p, "user"), "full_name")
		}
	}
	if !progress.IsError {
		p := jsonx.Object(jsonx.Parse([]byte(progress.Text)))
		uc.Stage = jsonx.Str(jsonx.Get(p, "current_stage"), "title")
		if uc.Stage == "" {
			uc.Stage = jsonx.Str(p, "current_stage")
		}
		uc.Progress = jsonx.Int(p, "percent", "total_percent")
	}
	return uc
}

// Suggestion — подсказка-кнопка.
type Suggestion struct {
	Text string `json:"text"`
}

// Suggestions возвращает 3–4 стартовые подсказки с учётом роли и состояния адаптации.
func (o *Orchestrator) Suggestions(ctx context.Context, id Identity, token string) []Suggestion {
	texts := []string{"Что мне делать дальше?", "Какие доступы мне нужны?", "Как оформить отгул?", "Как у нас проходит код-ревью?"}
	switch id.Role {
	case "lead":
		texts = []string{"Что мне согласовать?", "Как у нас проходит код-ревью?", "Когда у нас стендап?", "Как оформить отгул?"}
	case "buddy", "hr":
		texts = []string{"Как у нас проходит код-ревью?", "Когда у нас стендап?", "Где документация команды?", "Как оформить отгул?"}
	case "intern":
		ctx, cancel := context.WithTimeout(ctx, o.Cfg.ToolTimeout)
		defer cancel()
		sess, err := o.MCP.Connect(ctx, token)
		if err != nil {
			break
		}
		defer sess.Close()
		if r := sess.Call(ctx, "get_access_overview", nil, ""); !r.IsError {
			missing := false
			for _, s := range jsonx.Items(jsonx.Parse([]byte(r.Text)), "systems") {
				missing = missing || jsonx.Str(s, "status") == "missing"
			}
			if !missing {
				texts[1] = "Когда у нас стендап?"
			}
		}
		if r := sess.Call(ctx, "get_next_steps", nil, ""); !r.IsError {
			if len(jsonx.Items(jsonx.Parse([]byte(r.Text)))) == 0 {
				texts[0] = "Какой у меня прогресс адаптации?"
			}
		}
	}
	out := make([]Suggestion, 0, len(texts))
	for _, t := range texts {
		out = append(out, Suggestion{Text: t})
	}
	return out
}
