package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func sseServer(t *testing.T, status int, lines []string, captured *map[string]any, auth *string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if captured != nil {
			_ = json.Unmarshal(body, captured)
		}
		if auth != nil {
			*auth = r.Header.Get("Authorization")
		}
		if r.URL.Path != "/chat/completions" {
			t.Errorf("путь %s", r.URL.Path)
		}
		w.WriteHeader(status)
		for _, l := range lines {
			fmt.Fprintf(w, "data: %s\n\n", l)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestOpenAIStreamingTextAndTools(t *testing.T) {
	var sent map[string]any
	var auth string
	srv := sseServer(t, 200, []string{
		`{"choices":[{"delta":{"role":"assistant","content":"Сейчас "}}]}`,
		`{"choices":[{"delta":{"content":"проверю."}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search_knowledge","arguments":"{\"que"}}]}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ry\":\"отгул\"}"}}]}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","function":{"name":"get_my_profile","arguments":""}}]}}]}`,
		`не json`,
		`{"choices":[]}`,
		`[DONE]`,
	}, &sent, &auth)
	c := NewOpenAI(srv.URL+"/", "test-model", "sk-test", time.Second)
	if c.Name() != "openai" {
		t.Error("Name")
	}
	var tokens []string
	resp, err := c.Chat(context.Background(), Request{
		Messages: []Message{
			{Role: RoleSystem, Content: "sys"},
			{Role: RoleUser, Content: "привет"},
			{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "c0", Name: "get_my_profile"}}},
			{Role: RoleTool, ToolCallID: "c0", Content: "{}"},
		},
		Tools: []ToolDef{{Name: "search_knowledge", Description: "поиск", Schema: json.RawMessage(`{"type":"object"}`)}},
	}, func(s string) { tokens = append(tokens, s) })
	if err != nil {
		t.Fatal(err)
	}
	if resp.Content != "Сейчас проверю." || strings.Join(tokens, "|") != "Сейчас |проверю." {
		t.Errorf("текст: %q %v", resp.Content, tokens)
	}
	if len(resp.ToolCalls) != 2 || resp.ToolCalls[0].Name != "search_knowledge" || string(resp.ToolCalls[0].Args) != `{"query":"отгул"}` ||
		resp.ToolCalls[1].ID != "call_2" || string(resp.ToolCalls[1].Args) != `{}` {
		t.Errorf("вызовы инструментов: %+v", resp.ToolCalls)
	}
	if auth != "Bearer sk-test" || sent["model"] != "test-model" || sent["stream"] != true || sent["tool_choice"] != "auto" {
		t.Errorf("запрос: auth=%q %+v", auth, sent)
	}
	msgs := sent["messages"].([]any)
	asst := msgs[2].(map[string]any)
	if asst["content"] != nil || asst["tool_calls"].([]any)[0].(map[string]any)["function"].(map[string]any)["arguments"] != "{}" {
		t.Errorf("сообщение ассистента с tool_calls: %+v", asst)
	}
	if msgs[3].(map[string]any)["tool_call_id"] != "c0" {
		t.Errorf("tool message: %+v", msgs[3])
	}
}

func TestOpenAIErrors(t *testing.T) {
	for _, c := range []struct {
		status    int
		retryable bool
	}{{500, true}, {503, true}, {429, true}, {401, false}, {400, false}} {
		srv := sseServer(t, c.status, nil, nil, nil)
		_, err := NewOpenAI(srv.URL, "m", "", time.Second).Chat(context.Background(), Request{}, nil)
		le, ok := err.(*Error)
		if !ok || le.Retryable != c.retryable || le.Status != c.status || !strings.Contains(le.Error(), fmt.Sprint(c.status)) {
			t.Errorf("статус %d: %+v", c.status, err)
		}
	}
	// Таймаут → retryable.
	slow := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	defer slow.Close()
	_, err := NewOpenAI(slow.URL, "m", "k", 50*time.Millisecond).Chat(context.Background(), Request{}, nil)
	if le, ok := err.(*Error); !ok || !le.Retryable {
		t.Errorf("таймаут: %v", err)
	}
	// Отмена клиентом — не ошибка провайдера.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewOpenAI(slow.URL, "m", "k", time.Second).Chat(ctx, Request{}, nil); err != context.Canceled {
		t.Errorf("отмена: %v", err)
	}
	if _, err := NewOpenAI("http://[::1]:namedport", "m", "k", time.Second).Chat(context.Background(), Request{}, nil); err == nil {
		t.Error("некорректный URL")
	}
}

func TestMockStreamingAndCancel(t *testing.T) {
	m := &Mock{Delay: time.Millisecond}
	if m.Name() != "mock" {
		t.Error("Name")
	}
	var n int
	resp, err := m.Chat(context.Background(), Request{Messages: []Message{{Role: RoleUser, Content: "привет"}}, User: UserContext{Name: "Анна Соколова"}}, func(string) { n++ })
	if err != nil || n < 3 || !strings.Contains(resp.Content, "Привет, Анна!") {
		t.Errorf("стриминг: %v %d %q", err, n, resp.Content)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := m.Chat(ctx, Request{Messages: []Message{{Role: RoleUser, Content: "привет"}}}, func(string) {}); err == nil {
		t.Error("отмена должна останавливать генерацию")
	}
	// Без сообщений и без имени.
	if resp, _ := m.Chat(context.Background(), Request{}, nil); !strings.Contains(resp.Content, "AI-buddy") {
		t.Errorf("пустой запрос: %q", resp.Content)
	}
	if firstName("") != "коллега" || summarize(strings.Repeat("Слово. ", 100), 50) == "" || !strings.HasSuffix(summarize(strings.Repeat("я", 100), 50), "…") {
		t.Error("вспомогательные функции")
	}
	// Ошибки инструментов объясняются по-человечески.
	for code, want := range map[string]string{"unauthorized": "сессия истекла", "upstream_unavailable": "временно недоступен", "forbidden": "недоступны", "validation_error": "Не получилось: плохие даты"} {
		if got := errorReply("ERROR code=" + code + ": плохие даты").Content; !strings.Contains(strings.ToLower(got), strings.ToLower(want)) {
			t.Errorf("%s: %q", code, got)
		}
	}
	if code, ok := isErr("ERROR без кода"); !ok || code != "internal_error" {
		t.Error("isErr")
	}
	// Эскалация без руководителя и наставника.
	resp, _ = m.Chat(context.Background(), Request{Messages: []Message{{Role: RoleUser, Content: "x"}}, User: UserContext{Escalate: "money"}}, nil)
	if !strings.Contains(resp.Content, "руководителю или HR") {
		t.Errorf("эскалация: %q", resp.Content)
	}
}
