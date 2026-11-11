package corpclient

import (
	"aibuddy/backend/internal/domain"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRetry(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer test" {
			t.Error("token missing")
		}
		if calls < 3 {
			w.WriteHeader(503)
			return
		}
		w.Write([]byte(`{"id":"ok"}`))
	}))
	defer server.Close()
	c := HTTP{URL: server.URL, Token: "test", Client: &http.Client{Timeout: time.Second}}
	r, e := c.Call(context.Background(), "POST", "/access/requests", domain.Request{}, true)
	if e != nil || r.ID != "ok" || calls != 3 {
		t.Fatal(r, e, calls)
	}
}
func TestPermanentFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(403) }))
	defer server.Close()
	c := HTTP{URL: server.URL, Client: server.Client()}
	if _, e := c.Call(context.Background(), "GET", "/x", domain.Request{}, false); e == nil {
		t.Fatal("accepted 403")
	}
}
func TestExhaustedRetries(t *testing.T) {
	calls := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(http.StatusServiceUnavailable) }))
	defer s.Close()
	c := HTTP{URL: s.URL, Client: s.Client()}
	if _, e := c.Call(context.Background(), "POST", "/access/requests", domain.Request{}, false); e == nil || calls != 3 {
		t.Fatalf("error=%v calls=%d", e, calls)
	}
}
func TestCancelledAndMalformed(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	c := HTTP{URL: "http://127.0.0.1:1", Client: &http.Client{Timeout: time.Second}}
	if _, e := c.Call(ctx, "GET", "/x", domain.Request{}, false); e == nil {
		t.Fatal("cancel ignored")
	}
	c.URL = ":invalid"
	if _, e := c.Call(context.Background(), "GET", "/x", domain.Request{}, false); e == nil {
		t.Fatal("bad URL accepted")
	}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("not JSON")) }))
	defer s.Close()
	c.URL = s.URL
	c.Client = s.Client()
	if _, e := c.Call(context.Background(), "GET", "/x", domain.Request{}, false); e == nil {
		t.Fatal("bad JSON accepted")
	}
}
