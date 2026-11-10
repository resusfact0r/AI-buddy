package httpapi

import (
	"aibuddy/backend/internal/domain"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecode(t *testing.T) {
	for _, s := range []string{`{`, `{"extra":1}`, `{} {}`} {
		r := httptest.NewRequest("POST", "/", strings.NewReader(s))
		if decode(r, &struct{}{}) == nil {
			t.Fatal(s)
		}
	}
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{}`))
	if e := decode(r, &struct{}{}); e != nil {
		t.Fatal(e)
	}
}
func TestHealthAndUnauthorized(t *testing.T) {
	a := &API{Secret: "secret"}
	for _, tc := range []struct {
		path string
		code int
	}{{"/healthz", 200}, {"/api/v1/me/profile", 401}} {
		w := httptest.NewRecorder()
		a.ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
		if w.Code != tc.code {
			t.Fatal(w.Code)
		}
	}
	w := httptest.NewRecorder()
	failure(w, domain.Err(403, "forbidden", "test"))
	if w.Code != 403 || !strings.Contains(w.Body.String(), "forbidden") {
		t.Fatal(w.Body)
	}
}
func TestInternalErrorEnvelope(t *testing.T) {
	w := httptest.NewRecorder()
	failure(w, fmt.Errorf("database failure"))
	if w.Code != 500 || strings.Contains(w.Body.String(), "database failure") {
		t.Fatal(w.Body.String())
	}
}
