// Package orchestrator — цикл агента: контекст пользователя → LLM ↔ MCP-инструменты → ответ.
// Чтение выполняется сразу, изменяющие действия превращаются в карточки и
// выполняются только после явного подтверждения пользователем.
package orchestrator

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"ai-buddy/agent/internal/apiclient"
	"ai-buddy/agent/internal/config"
	"ai-buddy/agent/internal/guard"
	"ai-buddy/agent/internal/jsonx"
	"ai-buddy/agent/internal/knowledge"
	"ai-buddy/agent/internal/llm"
	"ai-buddy/agent/internal/mcpclient"
	"ai-buddy/agent/internal/prompts"
	"ai-buddy/agent/internal/store"
)

// Emitter отправляет события фронту (SSE).
type Emitter interface {
	Emit(event string, data any)
}

// Identity — пользователь, от имени которого работает агент.
type Identity struct {
	ID   string
	Name string
	Role string
}

// ErrorBody — тело события error.
type ErrorBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

// Orchestrator связывает LLM, MCP, хранилище и API событий.
type Orchestrator struct {
	LLM   llm.Client
	MCP   mcpclient.Connector
	API   *apiclient.Client
	Store store.Store
	Cfg   config.Config
	Now   func() time.Time
	Log   *slog.Logger

	bg     sync.WaitGroup
	idMu   sync.Mutex
	idents map[string]identEntry
}

// New создаёт оркестратор.
func New(cfg config.Config, client llm.Client, mcp mcpclient.Connector, api *apiclient.Client, st store.Store, log *slog.Logger) *Orchestrator {
	if log == nil {
		log = slog.Default()
	}
	return &Orchestrator{LLM: client, MCP: mcp, API: api, Store: st, Cfg: cfg, Now: time.Now, Log: log,
		idents: map[string]identEntry{}}
}

// Wait дожидается фоновых задач (запись событий и истории) — нужно в тестах.
func (o *Orchestrator) Wait() { o.bg.Wait() }

func (o *Orchestrator) async(fn func(ctx context.Context)) {
	o.bg.Add(1)
	go func() {
		defer o.bg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		fn(ctx)
	}()
}

// event пишет событие метрик в POST /events Бэкенда 1 (в фоне, сбой не мешает ответу).
func (o *Orchestrator) event(token, typ string, payload map[string]any) {
	o.async(func(ctx context.Context) {
		if err := o.API.LogEvent(ctx, token, typ, payload); err != nil {
			o.Log.Warn("event not logged", "type", typ, "code", apiclient.AsError(err).Code)
		}
	})
}

func newID(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

var statusText = map[string]string{
	"search_knowledge":        "Ищу в базе знаний…",
	"get_knowledge_article":   "Читаю инструкцию…",
	"get_my_profile":          "Смотрю твой профиль…",
	"get_team_info":           "Смотрю информацию о команде…",
	"find_person":             "Ищу, к кому обратиться…",
	"get_onboarding_plan":     "Открываю план адаптации…",
	"get_onboarding_progress": "Считаю прогресс адаптации…",
	"get_next_steps":          "Смотрю следующие шаги…",
	"get_access_overview":     "Проверяю доступы…",
	"list_my_requests":        "Проверяю твои заявки…",
	"get_request":             "Проверяю статус заявки…",
	"list_pending_approvals":  "Смотрю заявки на согласование…",
}

// turn — состояние одного ответа.
type turn struct {
	id        Identity
	token     string
	conv      string
	sess      mcpclient.Session
	em        Emitter
	executed  int
	kb        knowledge.Tracker
	overview  []jsonx.Obj
	tasks     []jsonx.Obj
	approvals []jsonx.Obj
	proposals []string
	retryErr  *mcpclient.Result
}

const accessSchema = `{"type":"object","properties":{"systems":{"type":"array","items":{"type":"string"},"minItems":1,"description":"Коды ВСЕХ недостающих систем из get_access_overview (status=missing)."},"reason":{"type":"string","description":"Зачем нужны доступы, одна фраза."}},"required":["systems","reason"],"additionalProperties":false}`

func llmTools(ts []mcpclient.Tool) []llm.ToolDef {
	out := make([]llm.ToolDef, 0, len(ts))
	for _, t := range ts {
		d := llm.ToolDef{Name: t.Name, Description: t.Description, Schema: t.Schema}
		if t.Name == "create_access_request" {
			// Для модели — одна карточка на все системы; на подтверждении агент создаёт запрос по каждой.
			d.Schema = json.RawMessage(accessSchema)
			d.Description = "ДЕЙСТВИЕ: предложить пользователю ОДНУ карточку с запросом доступов ко всем недостающим системам. Запросы уйдут руководителю только после подтверждения."
		}
		out = append(out, d)
	}
	return out
}

// Chat обрабатывает сообщение пользователя и стримит события в em. Всегда завершается событием done.
func (o *Orchestrator) Chat(ctx context.Context, id Identity, token, conv, message string, em Emitter) {
	if conv == "" {
		conv = newID("c_")
	}
	defer em.Emit("done", map[string]string{"conversation_id": conv})
	em.Emit("status", map[string]string{"text": "Думаю…"})

	ctx, cancel := context.WithTimeout(ctx, o.Cfg.RequestTimeout)
	defer cancel()
	message = strings.TrimSpace(message)
	o.event(token, "question_asked", map[string]any{"conversation_id": conv, "length": len([]rune(message))})

	verdict := guard.CheckInput(message, o.Cfg.MaxMessageLen)
	if verdict.Kind == guard.Refuse {
		em.Emit("token", map[string]string{"text": verdict.Reply})
		o.remember(id, token, conv, message, verdict.Reply, nil)
		o.event(token, "guard_refused", map[string]any{"reason": verdict.Reason})
		return
	}

	sess, err := o.MCP.Connect(ctx, token)
	if err != nil {
		o.Log.Error("mcp connect failed", "user_id", id.ID, "err", err.Error())
		em.Emit("error", ErrorBody{Code: "tool_failed", Retryable: true,
			Message: "Не удалось подключиться к корпоративным сервисам. Попробуй ещё раз через минуту."})
		return
	}
	defer sess.Close()

	t := &turn{id: id, token: token, conv: conv, sess: sess, em: em}
	uc := o.userContext(ctx, sess, id)
	uc.Escalate = verdict.Topic

	msgs := []llm.Message{{Role: llm.RoleSystem, Content: prompts.System(uc)}}
	history, _ := o.Store.History(ctx, historyKey(id, conv), o.Cfg.HistoryLimit)
	for _, h := range history {
		msgs = append(msgs, llm.Message{Role: h.Role, Content: h.Content})
	}
	msgs = append(msgs, llm.Message{Role: llm.RoleUser, Content: message})

	needSep := false
	filter := &guard.StreamFilter{Secrets: []string{token, o.Cfg.LLMAPIKey}, Canary: prompts.Canary}
	filter.Emit = func(s string) { em.Emit("token", map[string]string{"text": s}) }
	onToken := func(s string) {
		if needSep && strings.TrimSpace(s) != "" {
			needSep = false
			if txt := filter.Text(); txt != "" && !strings.HasSuffix(txt, "\n") && !strings.HasSuffix(txt, " ") {
				filter.Write("\n\n")
			}
		}
		filter.Write(s)
	}

	tools := llmTools(sess.Tools())
	var failure *ErrorBody
	for round := 0; round < o.Cfg.MaxToolCalls+4; round++ {
		req := llm.Request{Messages: msgs, Tools: tools, User: uc}
		if t.executed >= o.Cfg.MaxToolCalls {
			req.Tools = nil // лимит инструментов исчерпан — модель обязана ответить текстом
		}
		resp, err := o.callLLM(ctx, req, onToken)
		if err != nil {
			failure = o.llmFailure(ctx, id, err)
			break
		}
		if filter.Leaked() || len(resp.ToolCalls) == 0 {
			break
		}
		filter.Flush()
		needSep = true
		msgs = append(msgs, llm.Message{Role: llm.RoleAssistant, Content: resp.Content, ToolCalls: resp.ToolCalls})
		for i, res := range o.runTools(ctx, t, resp.ToolCalls) {
			msgs = append(msgs, llm.Message{Role: llm.RoleTool, ToolCallID: resp.ToolCalls[i].ID,
				Name: resp.ToolCalls[i].Name, Content: guard.WrapToolResult(resp.ToolCalls[i].Name, res)})
		}
		if ctx.Err() != nil {
			failure = o.llmFailure(ctx, id, ctx.Err())
			break
		}
	}
	filter.Flush()
	answer := filter.Text()
	if filter.Leaked() {
		o.Log.Warn("system prompt leak blocked", "user_id", id.ID)
		answer = guard.LeakReply
		em.Emit("token", map[string]string{"text": "\n\n" + guard.LeakReply})
		o.event(token, "guard_refused", map[string]any{"reason": "prompt_leak"})
	}
	if failure == nil && strings.TrimSpace(answer) == "" && len(t.proposals) == 0 {
		answer = "Не получилось сформулировать ответ. Попробуй задать вопрос по-другому."
		em.Emit("token", map[string]string{"text": answer})
	}

	sources := t.kb.Sources()
	if len(sources) > 0 && failure == nil && !filter.Leaked() {
		em.Emit("sources", sources)
		o.event(token, "answered_from_kb", map[string]any{"sources": len(sources)})
	}
	if t.kb.Miss() {
		o.event(token, "kb_miss", map[string]any{"conversation_id": conv})
	}
	if verdict.Kind == guard.Escalate || t.kb.Miss() {
		o.event(token, "escalated_to_human", map[string]any{"topic": verdict.Topic, "kb_miss": t.kb.Miss()})
	}
	if failure != nil {
		em.Emit("error", failure)
	} else if t.retryErr != nil {
		em.Emit("error", ErrorBody{Code: "tool_failed", Retryable: true, Message: t.retryErr.Message})
	}
	if strings.TrimSpace(answer) != "" || len(t.proposals) > 0 {
		o.remember(id, token, conv, message, answer, t.proposals)
	}
}

func historyKey(id Identity, conv string) string { return id.ID + ":" + conv }

// remember сохраняет реплики в рабочую историю (Redis) и зеркалит в историю Бэкенда 1.
func (o *Orchestrator) remember(id Identity, token, conv, user, answer string, proposals []string) {
	stored := answer
	for _, p := range proposals {
		stored += "\n[Показана карточка действия: " + p + " — ждёт подтверждения пользователя]"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var msgs []store.Message
	if user != "" {
		msgs = append(msgs, store.Message{Role: llm.RoleUser, Content: user})
	}
	msgs = append(msgs, store.Message{Role: llm.RoleAssistant, Content: strings.TrimSpace(stored)})
	if err := o.Store.AppendHistory(ctx, historyKey(id, conv), o.Cfg.HistoryLimit, 24*time.Hour, msgs...); err != nil {
		o.Log.Warn("history not saved", "err", err.Error())
	}
	o.async(func(ctx context.Context) {
		if user != "" {
			_ = o.API.SaveMessage(ctx, token, apiclient.ChatMessage{ConversationID: conv, Role: llm.RoleUser, Content: user})
		}
		_ = o.API.SaveMessage(ctx, token, apiclient.ChatMessage{ConversationID: conv, Role: llm.RoleAssistant, Content: answer})
	})
}

// callLLM вызывает модель с одним повтором при 5xx/таймауте, если текст ещё не начал стримиться.
func (o *Orchestrator) callLLM(ctx context.Context, req llm.Request, onToken func(string)) (llm.Response, error) {
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		emitted := false
		lctx, cancel := context.WithTimeout(ctx, o.Cfg.LLMTimeout)
		resp, err := o.LLM.Chat(lctx, req, func(s string) { emitted = true; onToken(s) })
		timedOut := lctx.Err() != nil && ctx.Err() == nil
		cancel()
		if err == nil {
			return resp, nil
		}
		lastErr = err
		var le *llm.Error
		retryable := timedOut || (errors.As(err, &le) && le.Retryable)
		if !retryable || emitted || ctx.Err() != nil {
			break
		}
		o.Log.Warn("llm call failed, retrying", "attempt", attempt+1)
	}
	return llm.Response{}, lastErr
}

func (o *Orchestrator) llmFailure(ctx context.Context, id Identity, err error) *ErrorBody {
	if errors.Is(ctx.Err(), context.Canceled) {
		// Клиент отключился: генерацию останавливаем молча.
		return &ErrorBody{Code: "cancelled", Message: "Запрос отменён."}
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return &ErrorBody{Code: "timeout", Retryable: true, Message: "Ответ занял слишком много времени. Попробуй ещё раз."}
	}
	o.Log.Error("llm failed", "user_id", id.ID, "err", guard.Redact(err.Error(), o.Cfg.LLMAPIKey))
	return &ErrorBody{Code: "llm_unavailable", Retryable: true, Message: "ИИ-модель сейчас недоступна. Попробуй ещё раз через минуту."}
}

// runTools исполняет вызовы инструментов одного шага модели и возвращает тексты результатов.
func (o *Orchestrator) runTools(ctx context.Context, t *turn, calls []llm.ToolCall) []string {
	known := map[string]mcpclient.Tool{}
	for _, tool := range t.sess.Tools() {
		known[tool.Name] = tool
	}
	out := make([]string, len(calls))
	accessDone := false
	for i, c := range calls {
		tool, ok := known[c.Name]
		args := map[string]any{}
		if len(c.Args) > 0 {
			_ = json.Unmarshal(c.Args, &args)
		}
		switch {
		case !ok:
			// Инструмента нет в наборе роли (или модель его выдумала) — ничего не вызываем.
			out[i] = "ERROR code=forbidden: это действие недоступно пользователю."
		case !tool.ReadOnly:
			if c.Name == "create_access_request" {
				if accessDone {
					out[i] = "Объединено с предыдущей карточкой запроса доступов."
					continue
				}
				accessDone = true
				mergeAccess(args, calls[i+1:])
			}
			out[i] = o.propose(ctx, t, c.Name, args)
		case t.executed >= o.Cfg.MaxToolCalls:
			out[i] = "ERROR code=limit: достигнут лимит вызовов инструментов на один запрос. Ответь по уже полученным данным."
		default:
			t.executed++
			if text := statusText[c.Name]; text != "" {
				t.em.Emit("status", map[string]string{"text": text})
			}
			res := t.sess.Call(ctx, c.Name, args, "")
			o.observe(t, c.Name, args, res)
			out[i] = res.Text
		}
	}
	return out
}

// mergeAccess собирает системы из нескольких вызовов create_access_request в одну карточку.
func mergeAccess(args map[string]any, rest []llm.ToolCall) {
	systems := stringList(args["systems"])
	if s, ok := args["system"].(string); ok && s != "" {
		systems = append(systems, s)
	}
	for _, c := range rest {
		if c.Name != "create_access_request" {
			continue
		}
		var a map[string]any
		_ = json.Unmarshal(c.Args, &a)
		systems = append(systems, stringList(a["systems"])...)
		if s, ok := a["system"].(string); ok && s != "" {
			systems = append(systems, s)
		}
	}
	args["systems"] = systems
	delete(args, "system")
}

func stringList(v any) []string {
	var out []string
	switch x := v.(type) {
	case []any:
		for _, it := range x {
			if s, ok := it.(string); ok && s != "" {
				out = append(out, s)
			}
		}
	case []string:
		out = append(out, x...)
	}
	return out
}

// observe запоминает полезные для ответа данные из результатов чтения.
func (o *Orchestrator) observe(t *turn, name string, args map[string]any, res mcpclient.Result) {
	if res.IsError {
		if res.Retryable {
			r := res
			t.retryErr = &r
		}
		o.Log.Info("tool error", "tool", name, "code", res.Code, "user_id", t.id.ID)
		return
	}
	switch name {
	case "search_knowledge":
		t.kb.ObserveSearch(res.Text)
	case "get_knowledge_article":
		t.kb.ObserveArticle(res.Text)
	case "get_access_overview":
		t.overview = jsonx.Items(jsonx.Parse([]byte(res.Text)), "systems")
	case "get_onboarding_plan":
		if id, _ := args["user_id"].(string); id == "" {
			t.tasks = flattenTasks(res.Text)
		}
	case "list_pending_approvals":
		t.approvals = jsonx.Items(jsonx.Parse([]byte(res.Text)))
	}
}

func flattenTasks(plan string) []jsonx.Obj {
	var out []jsonx.Obj
	for _, st := range jsonx.Items(jsonx.Parse([]byte(plan)), "stages") {
		tasks, _ := st["tasks"].([]any)
		for _, raw := range tasks {
			if task, ok := raw.(map[string]any); ok {
				out = append(out, task)
			}
		}
	}
	return out
}
