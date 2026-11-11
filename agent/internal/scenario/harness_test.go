// Package scenario — сценарные тесты агента по критериям приёмки из specs/.
// Поднимается полная цепочка: HTTP API агента → оркестратор → MCP (Streamable HTTP) →
// имитация API Бэкенда 1. LLM — детерминированный mock (LLM_PROVIDER=mock).
package scenario

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ai-buddy/agent/internal/apiclient"
	"ai-buddy/agent/internal/config"
	"ai-buddy/agent/internal/fakeapi"
	"ai-buddy/agent/internal/httpapi"
	"ai-buddy/agent/internal/llm"
	"ai-buddy/agent/internal/mcpclient"
	"ai-buddy/agent/internal/orchestrator"
	"ai-buddy/agent/internal/store"
	"ai-buddy/agent/internal/tools"
)

const (
	anna   = "intern_anna"
	boris  = "intern_boris"
	vera   = "intern_vera"
	dmitry = "buddy_dmitry"
	elena  = "lead_elena"
	fedor  = "lead_fedor"
)

// env — стенд одного теста.
type env struct {
	t     *testing.T
	api   *fakeapi.Server
	orch  *orchestrator.Orchestrator
	agent *httptest.Server
	mcp   *httptest.Server
	now   time.Time
}

// Среда, 11 ноября 2026 — как в спеках.
var testNow = time.Date(2026, 11, 11, 12, 0, 0, 0, time.UTC)

func newEnv(t *testing.T, client llm.Client) *env {
	t.Helper()
	e := &env{t: t, now: testNow}
	clock := func() time.Time { return e.now }
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	e.api = fakeapi.New()
	e.api.Now = clock
	apiSrv := httptest.NewServer(e.api.Handler())
	t.Cleanup(apiSrv.Close)

	cfg := config.Load(func(k string) string {
		return map[string]string{"API_BASE_URL": apiSrv.URL, "LLM_PROVIDER": "mock", "AGENT_RATE_LIMIT": "1000"}[k]
	})
	e.mcp = httptest.NewServer(tools.NewServer(apiclient.New(apiSrv.URL, cfg.ToolTimeout), cfg.ToolTimeout, log).Handler())
	t.Cleanup(e.mcp.Close)

	if client == nil {
		client = &llm.Mock{}
	}
	mem := store.NewMemory()
	mem.Now = clock
	e.orch = orchestrator.New(cfg, client, &mcpclient.HTTP{URL: e.mcp.URL + "/mcp", Timeout: cfg.ToolTimeout},
		apiclient.New(apiSrv.URL, cfg.ToolTimeout), mem, log)
	e.orch.Now = clock
	e.agent = httptest.NewServer((&httpapi.Server{Orch: e.orch, Log: log}).Handler())
	t.Cleanup(e.agent.Close)
	return e
}

type proposal struct {
	ActionID string         `json:"action_id"`
	Type     string         `json:"type"`
	Title    string         `json:"title"`
	Summary  string         `json:"summary"`
	Params   map[string]any `json:"params"`
	Options  map[string]any `json:"options"`
}

type source struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type reply struct {
	HTTP      int
	Text      string
	Statuses  []string
	Sources   []source
	Proposals []proposal
	Errors    []orchestrator.ErrorBody
	Events    []string
	Conv      string
	Body      string
}

func (e *env) post(login, path string, body any, accept string) *http.Response {
	e.t.Helper()
	data, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, e.agent.URL+path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	if login != "" {
		req.Header.Set("Authorization", "Bearer "+fakeapi.Token(login))
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatalf("POST %s: %v", path, err)
	}
	return resp
}

// say отправляет сообщение в чат и разбирает SSE-поток.
func (e *env) say(login, conv, msg string) reply {
	e.t.Helper()
	resp := e.post(login, "/api/v1/agent/chat", map[string]string{"message": msg, "conversation_id": conv}, "")
	defer resp.Body.Close()
	r := parseSSE(e.t, resp)
	e.orch.Wait()
	return r
}

func parseSSE(t *testing.T, resp *http.Response) reply {
	t.Helper()
	r := reply{HTTP: resp.StatusCode}
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		b, _ := io.ReadAll(resp.Body)
		r.Body = string(b)
		return r
	}
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	event := ""
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			event = line[7:]
			r.Events = append(r.Events, event)
		case strings.HasPrefix(line, "data: "):
			data := []byte(line[6:])
			switch event {
			case "token":
				var d struct{ Text string }
				_ = json.Unmarshal(data, &d)
				r.Text += d.Text
			case "status":
				var d struct{ Text string }
				_ = json.Unmarshal(data, &d)
				r.Statuses = append(r.Statuses, d.Text)
			case "sources":
				_ = json.Unmarshal(data, &r.Sources)
			case "action_proposal":
				var p proposal
				_ = json.Unmarshal(data, &p)
				r.Proposals = append(r.Proposals, p)
			case "error":
				var eb orchestrator.ErrorBody
				_ = json.Unmarshal(data, &eb)
				r.Errors = append(r.Errors, eb)
			case "done":
				var d struct {
					ConversationID string `json:"conversation_id"`
				}
				_ = json.Unmarshal(data, &d)
				r.Conv = d.ConversationID
			}
		}
	}
	if len(r.Events) == 0 || r.Events[len(r.Events)-1] != "done" {
		t.Errorf("поток должен заканчиваться событием done, события: %v", r.Events)
	}
	return r
}

type confirmResult struct {
	HTTP int
	orchestrator.ActionResult
	Err struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
}

func (e *env) confirm(login, actionID string, params map[string]any) confirmResult {
	e.t.Helper()
	var body any
	if params != nil {
		body = map[string]any{"params": params}
	}
	resp := e.post(login, "/api/v1/agent/actions/"+actionID+"/confirm", body, "")
	defer resp.Body.Close()
	out := confirmResult{HTTP: resp.StatusCode}
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == 200 {
		_ = json.Unmarshal(data, &out.ActionResult)
	} else {
		_ = json.Unmarshal(data, &out.Err)
	}
	e.orch.Wait()
	return out
}

func (e *env) cancel(login, actionID string) int {
	e.t.Helper()
	resp := e.post(login, "/api/v1/agent/actions/"+actionID+"/cancel", nil, "")
	defer resp.Body.Close()
	e.orch.Wait()
	return resp.StatusCode
}

func (e *env) hasEvent(typ string) bool {
	for _, ev := range e.api.Events() {
		if ev.Type == typ {
			return true
		}
	}
	return false
}

func contains(t *testing.T, text string, parts ...string) {
	t.Helper()
	for _, p := range parts {
		if !strings.Contains(text, p) {
			t.Errorf("в ответе нет %q:\n%s", p, text)
		}
	}
}

func notContains(t *testing.T, text string, parts ...string) {
	t.Helper()
	for _, p := range parts {
		if strings.Contains(text, p) {
			t.Errorf("в ответе не должно быть %q:\n%s", p, text)
		}
	}
}

func oneProposal(t *testing.T, r reply, typ string) proposal {
	t.Helper()
	if len(r.Proposals) != 1 {
		t.Fatalf("ожидалась одна карточка %s, получено %d; текст: %s", typ, len(r.Proposals), r.Text)
	}
	if r.Proposals[0].Type != typ {
		t.Fatalf("тип карточки %q, ожидался %q", r.Proposals[0].Type, typ)
	}
	return r.Proposals[0]
}

func noProposals(t *testing.T, r reply) {
	t.Helper()
	if len(r.Proposals) != 0 {
		t.Fatalf("карточек быть не должно, получено %d: %+v", len(r.Proposals), r.Proposals)
	}
}

func newRequest(e *env, login, path string) (*http.Request, error) {
	req, err := http.NewRequest(http.MethodGet, e.agent.URL+path, nil)
	if err == nil && login != "" {
		req.Header.Set("Authorization", "Bearer "+fakeapi.Token(login))
	}
	return req, err
}
