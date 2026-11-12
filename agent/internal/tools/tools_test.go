package tools

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"ai-buddy/agent/internal/apiclient"
	"ai-buddy/agent/internal/fakeapi"
)

type recorded struct {
	Method, Path, Query, Auth, Idem, Body string
}

// mockAPI — мок API Бэкенда 1: записывает запросы и отвечает заданным статусом.
func mockAPI(t *testing.T, status int, body string) (*apiclient.Client, *[]recorded) {
	t.Helper()
	var reqs []recorded
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		reqs = append(reqs, recorded{r.Method, r.URL.Path, r.URL.RawQuery, r.Header.Get("Authorization"), r.Header.Get("Idempotency-Key"), string(b)})
		w.WriteHeader(status)
		if r.URL.Path == "/api/v1/me/profile" && status == 200 {
			_, _ = w.Write([]byte(`{"user":{"id":1},"team":{"id":7}}`))
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return apiclient.New(srv.URL, time.Second), &reqs
}

func spec(t *testing.T, name string) Spec {
	t.Helper()
	for _, s := range All() {
		if s.Name == name {
			return s
		}
	}
	t.Fatalf("нет инструмента %s", name)
	return Spec{}
}

// Каждый инструмент вызывает нужный эндпоинт API с токеном пользователя.
func TestToolsCallAPI(t *testing.T) {
	cases := []struct {
		tool   string
		args   map[string]any
		method string
		path   string
		query  string
		body   string
	}{
		{"get_my_profile", nil, "GET", "/api/v1/me/profile", "", ""},
		{"get_team_info", map[string]any{"team_id": "3"}, "GET", "/api/v1/teams/3", "", ""},
		{"get_team_info", nil, "GET", "/api/v1/teams/7", "", ""},
		{"find_person", map[string]any{"query": "Борис"}, "GET", "/api/v1/people", "query=%D0%91%D0%BE%D1%80%D0%B8%D1%81", ""},
		{"search_knowledge", map[string]any{"query": "отгул", "tags": []any{"a", "b"}}, "GET", "/api/v1/knowledge/search", "tags=a%2Cb", ""},
		{"get_knowledge_article", map[string]any{"id": json.Number("5")}, "GET", "/api/v1/knowledge/5", "", ""},
		{"get_onboarding_plan", map[string]any{"user_id": "2"}, "GET", "/api/v1/onboarding/plan", "user_id=2", ""},
		{"get_onboarding_progress", nil, "GET", "/api/v1/onboarding/progress", "", ""},
		{"get_next_steps", nil, "GET", "/api/v1/onboarding/next-steps", "", ""},
		{"get_access_overview", nil, "GET", "/api/v1/access/overview", "", ""},
		{"list_my_requests", map[string]any{"type": "leave", "status": "pending"}, "GET", "/api/v1/requests", "status=pending&type=leave", ""},
		{"get_request", map[string]any{"id": 12.0}, "GET", "/api/v1/requests/12", "", ""},
		{"list_pending_approvals", nil, "GET", "/api/v1/approvals/pending", "", ""},
		{"create_leave_request", map[string]any{"date_from": "2026-11-13", "date_to": "2026-11-13", "reason_type": "day_off"}, "POST", "/api/v1/requests/leave", "", `"date_from":"2026-11-13"`},
		{"create_access_request", map[string]any{"system": "grafana", "reason": "нужно"}, "POST", "/api/v1/requests/access", "", `"system_code":"grafana"`},
		{"update_task_status", map[string]any{"task_id": "3", "status": "done"}, "PATCH", "/api/v1/onboarding/tasks/3", "", `"status":"done"`},
		{"approve_request", map[string]any{"request_id": "9"}, "POST", "/api/v1/requests/9/approve", "", ""},
		{"reject_request", map[string]any{"request_id": "9", "comment": "нет"}, "POST", "/api/v1/requests/9/reject", "", `"comment":"нет"`},
	}
	for _, c := range cases {
		api, reqs := mockAPI(t, 200, `{"ok":true}`)
		_, err := spec(t, c.tool).Run(context.Background(), Call{API: api, Token: "user-jwt", Args: c.args, IdempotencyKey: "act_1"})
		if err != nil {
			t.Errorf("%s: %v", c.tool, err)
			continue
		}
		got := (*reqs)[len(*reqs)-1]
		if got.Method != c.method || got.Path != c.path {
			t.Errorf("%s: %s %s, ожидалось %s %s", c.tool, got.Method, got.Path, c.method, c.path)
		}
		if c.query != "" && !strings.Contains(got.Query, c.query) {
			t.Errorf("%s: query %q не содержит %q", c.tool, got.Query, c.query)
		}
		if c.body != "" && !strings.Contains(got.Body, c.body) {
			t.Errorf("%s: body %q не содержит %q", c.tool, got.Body, c.body)
		}
		if got.Auth != "Bearer user-jwt" {
			t.Errorf("%s: токен пользователя не проброшен: %q", c.tool, got.Auth)
		}
		if !spec(t, c.tool).ReadOnly && got.Idem != "act_1" {
			t.Errorf("%s: Idempotency-Key = %q, ожидался action_id", c.tool, got.Idem)
		}
	}
}

func TestGetTeamInfoWithoutTeam(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"user":{"id":1}}`)) }))
	defer srv.Close()
	_, err := spec(t, "get_team_info").Run(context.Background(), Call{API: apiclient.New(srv.URL, time.Second)})
	if e := apiclient.AsError(err); e == nil || e.Code != apiclient.CodeNotFound {
		t.Errorf("ожидался not_found: %v", err)
	}
	api, _ := mockAPI(t, 403, `{"error":{"code":"forbidden","message":"x"}}`)
	if _, err := spec(t, "get_team_info").Run(context.Background(), Call{API: api}); err == nil {
		t.Error("ошибка профиля должна вернуться")
	}
}

// Нормализация ошибок API в краткий безопасный текст для модели.
func TestNormalizeErrors(t *testing.T) {
	cases := []struct {
		status    int
		body      string
		code      string
		contains  string
		retryable bool
	}{
		{401, ``, "unauthorized", "войти заново", false},
		{403, `{"error":{"code":"forbidden","message":"Заявка Бориса Орлова недоступна"}}`, "forbidden", "Недостаточно прав", false},
		{404, `{"error":{"code":"not_found","message":"нет"}}`, "not_found", "Не найдено", false},
		{400, `{"error":{"code":"validation_error","message":"Дата начала не может быть в прошлом"}}`, "validation_error", "в прошлом", false},
		{409, `{"error":{"code":"conflict","message":"На эти даты уже есть активная заявка"}}`, "conflict", "уже есть активная заявка", false},
		{422, ``, "validation_error", "проверь параметры", false},
		{503, `{"error":{"code":"upstream_unavailable","message":"corp-mock down","retryable":true}}`, "upstream_unavailable", "временно недоступен", true},
		{502, `<html>bad gateway</html>`, "upstream_unavailable", "временно недоступен", true},
		{500, `{"error":{"code":"internal","message":"panic: runtime error at handler.go:42"}}`, "internal_error", "Внутренняя ошибка", true},
		{400, `{"error":{"code":"validation_error","message":"pq: SQLSTATE 23505 goroutine 1"}}`, "validation_error", "проверь параметры", false},
	}
	for _, c := range cases {
		api, _ := mockAPI(t, c.status, c.body)
		_, err := api.Get(context.Background(), "tok", "/x", nil)
		te := Normalize(err)
		if te.Code != c.code || !strings.Contains(te.Message, c.contains) || te.Retryable != c.retryable {
			t.Errorf("%d %s → %+v, ожидалось %s/%q/%v", c.status, c.body, te, c.code, c.contains, c.retryable)
		}
		for _, leak := range []string{"Бориса", "panic", "SQLSTATE", "handler.go", "corp-mock"} {
			if strings.Contains(te.Message, leak) {
				t.Errorf("утечка %q в тексте ошибки: %s", leak, te.Message)
			}
		}
		parsed, ok := ParseError(te.Error())
		if !ok || parsed.Code != te.Code || parsed.Retryable != te.Retryable || parsed.Message != te.Message {
			t.Errorf("ParseError не восстановил ошибку: %+v", parsed)
		}
	}
	long := Normalize(&apiclient.Error{Code: apiclient.CodeValidation, Message: strings.Repeat("я", 400)})
	if len([]rune(long.Message)) != 301 {
		t.Errorf("длинное сообщение должно обрезаться: %d", len([]rune(long.Message)))
	}
	if te := Normalize(&apiclient.Error{Code: apiclient.CodeTimeout}); !te.Retryable || te.Code != "timeout" {
		t.Errorf("timeout: %+v", te)
	}
	if _, ok := ParseError("обычный текст"); ok {
		t.Error("обычный текст не является ошибкой")
	}
}

// Таймаут инструмента.
func TestToolTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	defer srv.Close()
	api := apiclient.New(srv.URL, 50*time.Millisecond)
	_, err := api.Get(context.Background(), "tok", "/slow", nil)
	if te := Normalize(err); te.Code != "timeout" || !te.Retryable {
		t.Errorf("ожидался timeout: %+v", te)
	}
}

// AC-00-2: набор инструментов фильтруется по роли.
func TestAC_00_2_RoleFilter(t *testing.T) {
	names := func(role string) map[string]bool {
		m := map[string]bool{}
		for _, s := range ForRole(role) {
			m[s.Name] = true
		}
		return m
	}
	intern, lead, buddy, unknown := names(RoleIntern), names(RoleLead), names(RoleBuddy), names("")
	for _, leadOnly := range []string{"approve_request", "reject_request", "list_pending_approvals"} {
		if intern[leadOnly] || buddy[leadOnly] || unknown[leadOnly] || !lead[leadOnly] {
			t.Errorf("%s должен быть только у руководителя", leadOnly)
		}
	}
	if !intern["update_task_status"] || lead["update_task_status"] || buddy["update_task_status"] {
		t.Error("update_task_status — только стажёр")
	}
	if len(intern) != 14 || len(lead) != 16 || len(All()) != 17 {
		t.Errorf("число инструментов: intern=%d lead=%d all=%d", len(intern), len(lead), len(All()))
	}
	for _, s := range All() {
		var schema map[string]any
		if err := json.Unmarshal([]byte(s.Schema), &schema); err != nil || schema["type"] != "object" || schema["additionalProperties"] != false {
			t.Errorf("%s: схема должна быть строгой (additionalProperties=false): %v", s.Name, err)
		}
		if len([]rune(s.Description)) < 20 {
			t.Errorf("%s: слишком короткое описание", s.Name)
		}
		if !s.ReadOnly && !strings.HasPrefix(s.Description, "ДЕЙСТВИЕ") {
			t.Errorf("%s: описание действия должно начинаться с «ДЕЙСТВИЕ»", s.Name)
		}
	}
}

func connect(t *testing.T, url, token string) *mcp.ClientSession {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "0"}, nil)
	cs, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{
		Endpoint: url, DisableStandaloneSSE: true, MaxRetries: -1,
		HTTPClient: &http.Client{Transport: roundTripper(func(r *http.Request) (*http.Response, error) {
			if token != "" {
				r.Header.Set("Authorization", "Bearer "+token)
			}
			return http.DefaultTransport.RoundTrip(r)
		})},
	}, nil)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = cs.Close() })
	return cs
}

type roundTripper func(*http.Request) (*http.Response, error)

func (f roundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// MCP-сервер по Streamable HTTP: список по роли, строгая схема, проброс JWT и ключа идемпотентности.
func TestMCPServerOverHTTP(t *testing.T) {
	api := fakeapi.New()
	api.Now = func() time.Time { return time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC) }
	apiSrv := httptest.NewServer(api.Handler())
	defer apiSrv.Close()
	srv := NewServer(apiclient.New(apiSrv.URL, time.Second), time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)))
	mcpSrv := httptest.NewServer(srv.Handler())
	defer mcpSrv.Close()

	resp, err := http.Get(mcpSrv.URL + "/healthz")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("healthz: %v", err)
	}
	resp.Body.Close()

	list := func(token string) (map[string]*mcp.Tool, *mcp.ClientSession) {
		cs := connect(t, mcpSrv.URL+"/mcp", token)
		res, err := cs.ListTools(context.Background(), nil)
		if err != nil {
			t.Fatalf("tools/list: %v", err)
		}
		m := map[string]*mcp.Tool{}
		for _, tool := range res.Tools {
			m[tool.Name] = tool
		}
		return m, cs
	}
	internTools, anna := list(fakeapi.Token("intern_anna"))
	leadTools, _ := list(fakeapi.Token("lead_elena"))
	anonTools, anon := list("")
	if internTools["approve_request"] != nil || leadTools["approve_request"] == nil || anonTools["approve_request"] != nil || anonTools["update_task_status"] != nil {
		t.Error("AC-00-2: фильтрация по роли в tools/list не работает")
	}
	if !internTools["search_knowledge"].Annotations.ReadOnlyHint || internTools["create_leave_request"].Annotations.ReadOnlyHint {
		t.Error("readOnlyHint должен отличать чтение от действий")
	}

	text := func(res *mcp.CallToolResult) string {
		var sb strings.Builder
		for _, c := range res.Content {
			if tc, ok := c.(*mcp.TextContent); ok {
				sb.WriteString(tc.Text)
			}
		}
		return sb.String()
	}
	ctx := context.Background()
	res, err := anna.CallTool(ctx, &mcp.CallToolParams{Name: "get_my_profile", Arguments: map[string]any{}})
	if err != nil || res.IsError || !strings.Contains(text(res), "Анна Соколова") {
		t.Fatalf("get_my_profile: %v %s", err, text(res))
	}
	// Строгая схема: лишнее поле и неверный формат даты отклоняются до вызова API.
	res, _ = anna.CallTool(ctx, &mcp.CallToolParams{Name: "search_knowledge", Arguments: map[string]any{"query": "отгул", "extra": 1}})
	if !res.IsError {
		t.Error("лишнее поле должно отклоняться схемой")
	}
	res, _ = anna.CallTool(ctx, &mcp.CallToolParams{Name: "create_leave_request", Arguments: map[string]any{"date_from": "13.11.2026", "date_to": "13.11.2026", "reason_type": "day_off"}})
	if !res.IsError || api.RequestCount("leave", "") != 0 {
		t.Error("неверный формат даты должен отклоняться схемой")
	}
	// Ключ идемпотентности из _meta уходит в Idempotency-Key: повтор не создаёт дубль.
	params := &mcp.CallToolParams{Name: "create_leave_request", Meta: mcp.Meta{MetaIdempotencyKey: "act_42"},
		Arguments: map[string]any{"date_from": "2026-11-13", "date_to": "2026-11-13", "reason_type": "day_off"}}
	for i := 0; i < 2; i++ {
		if res, err = anna.CallTool(ctx, params); err != nil || res.IsError {
			t.Fatalf("create_leave_request: %v %s", err, text(res))
		}
	}
	if api.RequestCount("leave", "") != 1 || api.LastIdempotencyKeys()[0] != "act_42" {
		t.Errorf("идемпотентность: заявок %d, ключи %v", api.RequestCount("leave", ""), api.LastIdempotencyKeys())
	}
	// Ошибка API → нормализованный текст с isError.
	res, _ = anna.CallTool(ctx, &mcp.CallToolParams{Name: "get_onboarding_plan", Arguments: map[string]any{"user_id": "2"}})
	if te, ok := ParseError(text(res)); !res.IsError || !ok || te.Code != "forbidden" {
		t.Errorf("ожидался forbidden: %s", text(res))
	}
	// Без токена API отвечает 401.
	res, _ = anon.CallTool(ctx, &mcp.CallToolParams{Name: "get_my_profile", Arguments: map[string]any{}})
	if te, ok := ParseError(text(res)); !ok || te.Code != "unauthorized" {
		t.Errorf("ожидался unauthorized: %s", text(res))
	}
	// Инструмент чужой роли вызвать нельзя даже напрямую.
	if _, err := anna.CallTool(ctx, &mcp.CallToolParams{Name: "approve_request", Arguments: map[string]any{"request_id": "100"}}); err == nil {
		t.Error("стажёр не должен вызывать approve_request")
	}
	// Роль кэшируется.
	if srv.roleFor(ctx, fakeapi.Token("intern_anna")) != "intern" || srv.roleFor(ctx, "bad") != "" {
		t.Error("roleFor")
	}
}

func TestBearerToken(t *testing.T) {
	h := http.Header{}
	if BearerToken(h) != "" {
		t.Error("пустой заголовок")
	}
	h.Set("Authorization", "bearer  abc ")
	if BearerToken(h) != "abc" {
		t.Errorf("%q", BearerToken(h))
	}
	h.Set("Authorization", "Basic xyz")
	if BearerToken(h) != "" {
		t.Error("не bearer")
	}
}

// stdio-режим: сервер стартует и останавливается по отмене контекста.
func TestRunStdioStops(t *testing.T) {
	api, _ := mockAPI(t, 200, `{"role":"intern"}`)
	srv := NewServer(api, time.Second, nil)
	srv.StaticToken = "tok"
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan error, 1)
	go func() { done <- srv.RunStdio(ctx) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("RunStdio не остановился")
	}
}
