package apiclient

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestClientRequestsAndErrors(t *testing.T) {
	var got *http.Request
	var body string
	status, resp := 200, `{"ok":true}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got, body = r, string(b)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(resp))
	}))
	defer srv.Close()
	c := New(srv.URL+"/", time.Second)
	ctx := context.Background()

	raw, err := c.Do(ctx, Request{Method: "POST", Path: "/requests/leave", Token: "jwt", IdempotencyKey: "act_1",
		Body: map[string]string{"a": "b"}, Headers: map[string]string{"X-Mock-Fail": "true"}})
	if err != nil || string(raw) != `{"ok":true}` {
		t.Fatalf("Do: %s %v", raw, err)
	}
	if got.URL.Path != "/api/v1/requests/leave" || got.Header.Get("Authorization") != "Bearer jwt" ||
		got.Header.Get("Idempotency-Key") != "act_1" || got.Header.Get("X-Mock-Fail") != "true" || body != `{"a":"b"}` {
		t.Errorf("запрос: %s %v %s", got.URL.Path, got.Header, body)
	}
	if err := c.SaveMessage(ctx, "jwt", ChatMessage{ConversationID: "c", Role: "user", Content: "привет"}); err != nil || !strings.Contains(body, `"conversation_id":"c"`) {
		t.Errorf("SaveMessage: %v %s", err, body)
	}
	if err := c.LogEvent(ctx, "jwt", "question_asked", map[string]any{"n": 1}); err != nil || !strings.Contains(body, `"type":"question_asked"`) || got.URL.Path != "/api/v1/events" {
		t.Errorf("LogEvent: %v %s", err, body)
	}
	if _, err := c.Me(ctx, "jwt"); err != nil || got.URL.Path != "/api/v1/auth/me" {
		t.Errorf("Me: %v", err)
	}
	resp = ""
	if raw, _ := c.Get(ctx, "jwt", "/x", nil); string(raw) != "{}" {
		t.Errorf("пустой ответ: %s", raw)
	}

	for _, tc := range []struct {
		status    int
		body      string
		code      string
		retryable bool
		msg       string
	}{
		{401, ``, CodeUnauthorized, false, ""},
		{403, `{"error":{"code":"forbidden","message":"нельзя"}}`, CodeForbidden, false, "нельзя"},
		{404, `x`, CodeNotFound, false, ""},
		{409, ``, CodeConflict, false, ""},
		{400, ``, CodeValidation, false, ""},
		{503, `{"error":{"code":"upstream_unavailable","message":"сервис лежит","details":{"retryable":true}}}`, CodeUpstream, true, "сервис лежит"},
		{504, ``, CodeUpstream, true, ""},
		{500, `{"error":{"code":"internal","message":"stack trace"}}`, "internal", false, ""},
		{418, ``, CodeInternal, false, ""},
	} {
		status, resp = tc.status, tc.body
		_, err := c.Get(ctx, "jwt", "/x", nil)
		e := AsError(err)
		if e.Code != tc.code || e.Retryable != tc.retryable || e.Message != tc.msg || e.Status != tc.status {
			t.Errorf("%d: %+v", tc.status, e)
		}
		if !strings.Contains(e.Error(), tc.code) {
			t.Errorf("Error(): %s", e.Error())
		}
	}
	if AsError(nil) != nil || AsError(errors.New("x")).Code != CodeInternal {
		t.Error("AsError")
	}
	if _, err := c.Do(ctx, Request{Method: "POST", Path: "/x", Body: func() {}}); AsError(err).Code != CodeInternal {
		t.Error("несериализуемое тело")
	}
	if _, err := c.Do(ctx, Request{Method: "bad method", Path: "/x"}); AsError(err).Code != CodeInternal {
		t.Error("некорректный метод")
	}
	srv.Close()
	if _, err := c.Get(ctx, "jwt", "/x", nil); AsError(err).Code != CodeUpstream || !AsError(err).Retryable {
		t.Errorf("недоступный сервис: %v", err)
	}
}
