// Package evals — прогон eval-набора «запрос → ожидаемое поведение» против LLM.
// Стенд собирается в одном процессе: агент → MCP (Streamable HTTP) → имитация API
// с синтетическими данными и фиксированной датой, поэтому результаты воспроизводимы.
package evals

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"ai-buddy/agent/internal/apiclient"
	"ai-buddy/agent/internal/config"
	"ai-buddy/agent/internal/fakeapi"
	"ai-buddy/agent/internal/llm"
	"ai-buddy/agent/internal/mcpclient"
	"ai-buddy/agent/internal/orchestrator"
	"ai-buddy/agent/internal/store"
	"ai-buddy/agent/internal/tools"
)

// Step — предварительный шаг диалога (тот же разговор).
type Step struct {
	User    string `json:"user"`
	Message string `json:"message"`
	Confirm bool   `json:"confirm"` // подтвердить все карточки этого шага
}

// Expect — ожидаемое поведение агента.
type Expect struct {
	Tools       []string       `json:"tools"`        // все эти инструменты должны быть вызваны
	NoTools     []string       `json:"no_tools"`     // эти инструменты вызываться не должны
	Sources     *bool          `json:"sources"`      // должны ли прийти источники
	Proposal    string         `json:"proposal"`     // тип карточки; "none" — карточек быть не должно
	Params      map[string]any `json:"params"`       // ожидаемые параметры первой карточки
	ContainsAny []string       `json:"contains_any"` // в ответе есть хотя бы одна из подстрок (без учёта регистра)
	NotContains []string       `json:"not_contains"` // этих подстрок в ответе быть не должно
}

// Case — один eval-кейс.
type Case struct {
	ID      string `json:"id"`
	Spec    string `json:"spec"`
	Group   string `json:"group"`
	User    string `json:"user"`
	Before  []Step `json:"before"`
	Message string `json:"message"`
	Expect  Expect `json:"expect"`
}

// Result — результат кейса.
type Result struct {
	Case     Case
	Passed   bool
	Failures []string
	Tools    []string
	Text     string
	Duration time.Duration
}

// Today — фиксированная «сегодняшняя» дата стенда: среда, 11 ноября 2026.
var Today = time.Date(2026, 11, 11, 12, 0, 0, 0, time.UTC)

// Load читает кейсы из JSON-файла.
func Load(path string) ([]Case, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cases []Case
	if err := json.Unmarshal(data, &cases); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return cases, nil
}

// recorder записывает имена вызванных инструментов.
type recorder struct {
	mcpclient.Connector
	mu    sync.Mutex
	calls []string
	on    bool
}

type recSession struct {
	mcpclient.Session
	r *recorder
}

func (r *recorder) Connect(ctx context.Context, token string) (mcpclient.Session, error) {
	s, err := r.Connector.Connect(ctx, token)
	if err != nil {
		return nil, err
	}
	return &recSession{Session: s, r: r}, nil
}

func (s *recSession) Call(ctx context.Context, name string, args map[string]any, key string) mcpclient.Result {
	s.r.mu.Lock()
	if s.r.on {
		s.r.calls = append(s.r.calls, name)
	}
	s.r.mu.Unlock()
	return s.Session.Call(ctx, name, args, key)
}

// collector собирает события одного ответа.
type collector struct {
	mu        sync.Mutex
	text      strings.Builder
	sources   int
	proposals []map[string]any
	errors    []string
}

func (c *collector) Emit(event string, data any) {
	raw, _ := json.Marshal(data)
	c.mu.Lock()
	defer c.mu.Unlock()
	switch event {
	case "token":
		var d struct{ Text string }
		_ = json.Unmarshal(raw, &d)
		c.text.WriteString(d.Text)
	case "sources":
		var s []any
		_ = json.Unmarshal(raw, &s)
		c.sources = len(s)
	case "action_proposal":
		var p map[string]any
		_ = json.Unmarshal(raw, &p)
		c.proposals = append(c.proposals, p)
	case "error":
		c.errors = append(c.errors, string(raw))
	}
}

// Run прогоняет кейсы; для каждого кейса поднимается чистый стенд.
func Run(ctx context.Context, client llm.Client, cases []Case) []Result {
	results := make([]Result, 0, len(cases))
	for _, c := range cases {
		results = append(results, runCase(ctx, client, c))
	}
	return results
}

func runCase(ctx context.Context, client llm.Client, c Case) Result {
	start := time.Now()
	clock := func() time.Time { return Today }
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	api := fakeapi.New()
	api.Now = clock
	apiSrv := httptest.NewServer(api.Handler())
	defer apiSrv.Close()
	cfg := config.Load(func(k string) string {
		return map[string]string{"API_BASE_URL": apiSrv.URL, "LLM_PROVIDER": "mock", "AGENT_TIMEOUT_SEC": "60", "LLM_TIMEOUT_SEC": "45"}[k]
	})
	mcpSrv := httptest.NewServer(tools.NewServer(apiclient.New(apiSrv.URL, cfg.ToolTimeout), cfg.ToolTimeout, log).Handler())
	defer mcpSrv.Close()
	rec := &recorder{Connector: &mcpclient.HTTP{URL: mcpSrv.URL + "/mcp", Timeout: cfg.ToolTimeout}}
	mem := store.NewMemory()
	mem.Now = clock
	orch := orchestrator.New(cfg, client, rec, apiclient.New(apiSrv.URL, cfg.ToolTimeout), mem, log)
	orch.Now = clock

	res := Result{Case: c}
	conv := "eval-" + c.ID
	say := func(user, msg string) (*collector, error) {
		token := fakeapi.Token(user)
		id, err := orch.Identify(ctx, token)
		if err != nil {
			return nil, fmt.Errorf("пользователь %s: %w", user, err)
		}
		col := &collector{}
		orch.Chat(ctx, id, token, conv+"-"+user, msg, col)
		return col, nil
	}
	for _, st := range c.Before {
		col, err := say(st.User, st.Message)
		if err != nil {
			res.Failures = append(res.Failures, err.Error())
			break
		}
		if st.Confirm {
			token := fakeapi.Token(st.User)
			id, _ := orch.Identify(ctx, token)
			for _, p := range col.proposals {
				if _, err := orch.Confirm(ctx, id, token, fmt.Sprint(p["action_id"]), nil); err != nil {
					res.Failures = append(res.Failures, "подготовка: confirm: "+err.Error())
				}
			}
		}
	}
	rec.mu.Lock()
	rec.on, rec.calls = true, nil
	rec.mu.Unlock()
	col, err := say(c.User, c.Message)
	orch.Wait()
	if err != nil {
		res.Failures = append(res.Failures, err.Error())
		res.Duration = time.Since(start)
		return res
	}
	res.Tools = append(res.Tools, rec.calls...)
	res.Text = col.text.String()
	res.Failures = append(res.Failures, check(c.Expect, col, res.Tools)...)
	res.Passed = len(res.Failures) == 0
	res.Duration = time.Since(start)
	return res
}

func check(e Expect, col *collector, called []string) []string {
	var fails []string
	has := map[string]bool{}
	for _, t := range called {
		has[t] = true
	}
	for _, t := range e.Tools {
		if !has[t] {
			fails = append(fails, "не вызван инструмент "+t)
		}
	}
	for _, t := range e.NoTools {
		if has[t] {
			fails = append(fails, "вызван лишний инструмент "+t)
		}
	}
	if e.Sources != nil && *e.Sources != (col.sources > 0) {
		fails = append(fails, fmt.Sprintf("sources: ожидалось %v, получено %d", *e.Sources, col.sources))
	}
	switch e.Proposal {
	case "":
	case "none":
		if len(col.proposals) > 0 {
			fails = append(fails, fmt.Sprintf("карточек быть не должно, получено %d", len(col.proposals)))
		}
	default:
		if len(col.proposals) == 0 {
			fails = append(fails, "нет карточки "+e.Proposal)
		} else if got := fmt.Sprint(col.proposals[0]["type"]); got != e.Proposal {
			fails = append(fails, "тип карточки "+got+", ожидался "+e.Proposal)
		} else if params, ok := col.proposals[0]["params"].(map[string]any); ok {
			for k, want := range e.Params {
				g, _ := json.Marshal(params[k])
				w, _ := json.Marshal(want)
				if string(g) != string(w) {
					fails = append(fails, fmt.Sprintf("параметр %s = %s, ожидалось %s", k, g, w))
				}
			}
		}
	}
	low := strings.ToLower(col.text.String())
	if len(e.ContainsAny) > 0 {
		found := false
		for _, s := range e.ContainsAny {
			found = found || strings.Contains(low, strings.ToLower(s))
		}
		if !found {
			fails = append(fails, "в ответе нет ни одной из фраз: "+strings.Join(e.ContainsAny, " | "))
		}
	}
	for _, s := range e.NotContains {
		if strings.Contains(low, strings.ToLower(s)) {
			fails = append(fails, "в ответе есть запрещённая фраза: "+s)
		}
	}
	if len(col.errors) > 0 {
		fails = append(fails, "событие error: "+strings.Join(col.errors, "; "))
	}
	return fails
}

// Report формирует отчёт в Markdown.
func Report(results []Result, provider, model string, when time.Time) string {
	passed := 0
	groups := map[string][2]int{}
	var order []string
	for _, r := range results {
		g := groups[r.Case.Group]
		if _, ok := groups[r.Case.Group]; !ok {
			order = append(order, r.Case.Group)
		}
		g[1]++
		if r.Passed {
			passed++
			g[0]++
		}
		groups[r.Case.Group] = g
	}
	sort.Strings(order)
	pct := 0.0
	if len(results) > 0 {
		pct = float64(passed) * 100 / float64(len(results))
	}
	var b strings.Builder
	b.WriteString("# Отчёт по eval-набору AI-buddy\n\n")
	fmt.Fprintf(&b, "- Дата прогона: %s\n- LLM: `%s`", when.Format("2006-01-02 15:04"), provider)
	if model != "" {
		fmt.Fprintf(&b, ", модель `%s`", model)
	}
	fmt.Fprintf(&b, "\n- **Пройдено: %d из %d (%.0f%%)**\n\n", passed, len(results), pct)
	b.WriteString("| Группа | Пройдено |\n|---|---|\n")
	for _, g := range order {
		fmt.Fprintf(&b, "| %s | %d / %d |\n", g, groups[g][0], groups[g][1])
	}
	b.WriteString("\n| Кейс | Спека | Запрос | Инструменты | Результат |\n|---|---|---|---|---|\n")
	for _, r := range results {
		status := "✅"
		if !r.Passed {
			status = "❌ " + strings.ReplaceAll(strings.Join(r.Failures, "; "), "|", "/")
		}
		fmt.Fprintf(&b, "| %s | %s | %s | %s | %s |\n", r.Case.ID, r.Case.Spec, strings.ReplaceAll(r.Case.Message, "|", "/"),
			strings.Join(uniq(r.Tools), ", "), status)
	}
	return b.String()
}

func uniq(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// Summary возвращает число пройденных кейсов и общее число.
func Summary(results []Result) (passed, total int) {
	for _, r := range results {
		if r.Passed {
			passed++
		}
	}
	return passed, len(results)
}
