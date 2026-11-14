package httpapi

import (
	"aibuddy/backend/internal/auth"
	"aibuddy/backend/internal/corpclient"
	"aibuddy/backend/internal/corpmock"
	"aibuddy/backend/internal/service"
	"aibuddy/backend/internal/storage"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestIntegration(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_REDIS_URL; use isolated test database")
	}
	ctx := context.Background()
	config, e := pgxpool.ParseConfig(url)
	if e != nil {
		t.Fatal(e)
	}
	schema := "test_" + service.ID()
	config.ConnConfig.RuntimeParams["search_path"] = schema
	db, e := pgxpool.NewWithConfig(ctx, config)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if _, e = db.Exec(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer db.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	sql, e := os.ReadFile("../../migrations/000001_init.up.sql")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, string(sql)); e != nil {
		t.Fatal(e)
	}

	if _, e = db.Exec(ctx, `INSERT INTO teams VALUES('migration-team','{"id":"migration-team","name":"Migration test","tools":[],"is_test_data":true}');
 INSERT INTO users VALUES('migration-user','migration_login','hash','{"id":"migration-user","login":"migration_login","role":"intern","team_id":"migration-team","start_date":"2026-11-01"}');
 INSERT INTO requests VALUES('migration-request','migration-user','{"id":"migration-request","user_id":"migration-user","type":"leave","status":"pending","payload":{"comment":"preserve me"},"created_at":"2026-11-01T00:00:00Z","updated_at":"2026-11-01T00:00:00Z"}');`); e != nil {
		t.Fatal(e)
	}
	normalized, e := os.ReadFile("../../migrations/000002_normalize.up.sql")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, string(normalized)); e != nil {
		t.Fatal(e)
	}
	limits, e := os.ReadFile("../../migrations/000003_login_limits.up.sql")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(ctx, string(limits)); e != nil {
		t.Fatal(e)
	}
	store := &storage.Store{DB: db}
	var preserved string
	if e = db.QueryRow(ctx, "SELECT payload->>'comment' FROM requests WHERE id='migration-request'").Scan(&preserved); e != nil || preserved != "preserve me" {
		t.Fatal("migration lost data", e)
	}
	var snapshotCount int
	if e = db.QueryRow(ctx, "SELECT count(*) FROM requests_legacy").Scan(&snapshotCount); e != nil || snapshotCount != 1 {
		t.Fatal("migration snapshot missing", e)
	}
	if e = store.ResetDemo(ctx); e != nil {
		t.Fatal(e)
	}
	if e = store.Seed(ctx); e != nil {
		t.Fatal(e)
	}
	if e = store.Seed(ctx); e != nil {
		t.Fatal(e)
	}
	opts, e := redis.ParseURL(os.Getenv("TEST_REDIS_URL"))
	if e != nil {
		t.Fatal(e)
	}
	cache := redis.NewClient(opts)
	defer cache.Close()
	corp := httptest.NewServer(corpmock.Handler(db, "test-token", 0))
	defer corp.Close()
	svc := &service.Service{Repo: store, Corp: &corpclient.HTTP{URL: corp.URL, Token: "test-token", Client: corp.Client()}, Now: time.Now}
	a := &API{Store: store, Service: svc, Redis: cache, Secret: "integration-secret"}
	call := func(method, path, user, body, key string, want int) map[string]any {
		t.Helper()
		r := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		if user != "" {
			r.Header.Set("Authorization", "Bearer "+auth.Issue(user, a.Secret, time.Now()))
		}
		r.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		a.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s %s: got %d want %d: %s", method, path, user, w.Code, want, w.Body.String())
		}
		var b map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &b)
		return b
	}
	call("GET", "/readyz", "", "", "", 200)
	call("POST", "/auth/login", "", `{"login":"intern_anna","password":"test1234"}`, "", 200)
	call("POST", "/auth/login", "", `{"login":"intern_anna","password":"bad"}`, "", 401)
	for _, p := range []string{"/auth/me", "/me/profile", "/teams/delivery", "/onboarding/plan", "/onboarding/progress", "/onboarding/next-steps", "/access/overview", "/requests", "/knowledge/search?query=отгул", "/knowledge/common-0", "/chat/history?conversation_id=c"} {
		call("GET", p, "anna", "", "", 200)
	}
	call("GET", "/teams/frontend", "anna", "", "", 403)
	call("GET", "/onboarding/plan?user_id=vera", "anna", "", "", 403)
	call("GET", "/onboarding/plan?user_id=anna", "dmitry", "", "", 200)
	call("GET", "/knowledge/frontend-0", "anna", "", "", 403)
	call("GET", "/knowledge/missing", "anna", "", "", 404)
	call("GET", "/knowledge/search", "anna", "", "", 400)
	call("GET", "/unknown", "anna", "", "", 404)
	call("PATCH", "/onboarding/tasks/2", "anna", `{"status":"done","comment":"read"}`, "", 200)
	call("PATCH", "/onboarding/tasks/3", "anna", `{"status":"done"}`, "", 409)
	call("POST", "/chat/messages", "anna", `{"conversation_id":"c","role":"user","content":"hello","meta":{}}`, "", 201)
	call("GET", "/chat/history?conversation_id=c", "anna", "", "", 200)
	t.Run("history without conversation_id returns the latest conversation", func(t *testing.T) {
		call("POST", "/chat/messages", "anna", `{"conversation_id":"c-latest","role":"assistant","content":"latest answer","meta":{}}`, "", 201)
		for path, want := range map[string]string{"/chat/history": "latest answer", "/chat/history?conversation_id=c": "hello"} {
			r := httptest.NewRequest("GET", "/api/v1"+path, nil)
			r.Header.Set("Authorization", "Bearer "+auth.Issue("anna", a.Secret, time.Now()))
			w := httptest.NewRecorder()
			a.ServeHTTP(w, r)
			if w.Code != 200 || !strings.Contains(w.Body.String(), want) {
				t.Fatalf("%s: got %d %s, want message %q", path, w.Code, w.Body.String(), want)
			}
		}
		r := httptest.NewRequest("GET", "/api/v1/chat/history", nil)
		r.Header.Set("Authorization", "Bearer "+auth.Issue("boris", a.Secret, time.Now()))
		w := httptest.NewRecorder()
		a.ServeHTTP(w, r)
		if w.Code != 200 || strings.Contains(w.Body.String(), "latest answer") {
			t.Fatalf("another user's history leaked: %d %s", w.Code, w.Body.String())
		}
	})
	call("POST", "/events", "anna", `{"type":"question_asked","payload":{}}`, "", 201)
	t.Run("chat writes do not compete with request mutations", func(t *testing.T) {
		conn, err := db.Acquire(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Release()
		if _, err = conn.Exec(ctx, "SELECT pg_advisory_lock(814422)"); err != nil {
			t.Fatal(err)
		}
		defer conn.Exec(ctx, "SELECT pg_advisory_unlock(814422)")
		call("POST", "/chat/messages", "anna", `{"conversation_id":"parallel","role":"user","content":"hello"}`, "", 201)
		call("POST", "/events", "anna", `{"type":"question_asked","payload":{}}`, "", 201)
	})
	from := time.Now().AddDate(0, 0, 5).Format("2006-01-02")
	body := fmt.Sprintf(`{"date_from":%q,"date_to":%q,"reason_type":"day_off"}`, from, from)
	key := service.ID()
	req := call("POST", "/requests/leave", "anna", body, key, 201)
	again := call("POST", "/requests/leave", "anna", body, key, 200)
	if req["id"] != again["id"] {
		t.Fatal("idempotency duplicated")
	}
	call("POST", "/requests/leave", "anna", `{}`, key, 409)
	id := req["id"].(string)
	call("GET", "/requests/"+id, "anna", "", "", 200)
	call("GET", "/requests/"+id, "vera", "", "", 403)
	call("POST", "/requests/"+id+"/approve", "anna", `{}`, "", 403)
	call("POST", "/requests/"+id+"/approve", "fedor", `{}`, "", 403)
	call("GET", "/approvals/pending", "elena", "", "", 200)
	call("GET", "/approvals/pending", "anna", "", "", 403)
	call("POST", "/requests/"+id+"/approve", "elena", `{}`, "", 200)
	const readiness = "/onboarding/first-day-readiness"
	call("GET", readiness, "anna", "", "", 403)
	checkDay := func(want int) {
		t.Helper()
		report := call("GET", readiness, "elena", "", "", 200)
		raw, _ := json.Marshal(report["interns"])
		var days []internDay
		if err := json.Unmarshal(raw, &days); err != nil || len(days) != 2 || days[0].ID != "anna" || days[0].Ready != want || len(days[0].Tasks) != 3 || days[1].ID != "boris" {
			t.Fatalf("unexpected first-day readiness: %s", raw)
		}
	}
	checkDay(2)
	if _, e = db.Exec(ctx, "UPDATE onboarding_tasks SET link='/knowledge/frontend-0' WHERE code='task_2'"); e != nil {
		t.Fatal(e)
	}
	checkDay(1)
	if _, e = db.Exec(ctx, "UPDATE onboarding_tasks SET link='/knowledge/common-4' WHERE code='task_2'"); e != nil {
		t.Fatal(e)
	}
	access := call("POST", "/requests/access", "anna", `{"system_code":"grafana","reason":"work"}`, service.ID(), 201)
	call("POST", "/requests/"+access["id"].(string)+"/approve", "elena", `{}`, "", 200)
	call("POST", "/requests/seed-access-1/approve", "elena", `{}`, "", 200)
	checkDay(3)
	p, e := store.Plan(ctx, "anna")
	if e != nil || p[0].Tasks[2].Status != "done" {
		t.Fatal("access task not done", e)
	}
	for _, tc := range []struct {
		method, path, body string
		code               int
	}{
		{"GET", "/healthz", "", 200}, {"GET", "/access/systems", "", 200}, {"GET", "/bad", "", 404},
		{"POST", "/access/requests", "{", 400}, {"GET", "/access/requests/missing", "", 404},
		{"POST", "/access/requests/missing/decision", `{"status":"approved"}`, 404},
		{"POST", "/access/requests/missing/decision", `{"status":"bad"}`, 400},
		{"DELETE", "/access/requests", "", 404},
		{"POST", "/access/requests/seed-access-1/decision", `{"status":"rejected"}`, 409},
	} {
		r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		r.Header.Set("Authorization", "Bearer test-token")
		w := httptest.NewRecorder()
		corpmock.Handler(db, "test-token", 0).ServeHTTP(w, r)
		if w.Code != tc.code {
			t.Fatalf("corp %s: %d %s", tc.path, w.Code, w.Body.String())
		}
	}
	for _, fail := range []bool{false, true} {
		r := httptest.NewRequest("GET", "/access/systems", nil)
		if fail {
			r.Header.Set("Authorization", "Bearer test-token")
			r.Header.Set("X-Mock-Fail", "true")
		}
		w := httptest.NewRecorder()
		corpmock.Handler(db, "test-token", 0).ServeHTTP(w, r)
		want := 401
		if fail {
			want = 503
		}
		if w.Code != want {
			t.Fatal(w.Code)
		}
	}
	call("POST", "/events", "anna", `{}`, "", 400)
	call("POST", "/chat/messages", "anna", `{"role":"system"}`, "", 400)
	call("POST", "/requests/access", "anna", `{}`, "", 400)
	call("POST", "/requests/access", "anna", `{}`, service.ID(), 400)
	call("POST", "/requests/access", "anna", `{`, service.ID(), 400)
	call("GET", "/chat/history?conversation_id=c&limit=200", "anna", "", "", 200)
	call("GET", "/requests?type=access&status=pending", "elena", "", "", 200)
	call("GET", "/onboarding/missing", "anna", "", "", 404)
	call("POST", "/requests/missing/wrong", "anna", `{}`, "", 404)
	call("POST", "/auth/login", "", `{`, "", 400)
	for i := 0; i < 11; i++ {
		if i == 5 {
			a.Redis = nil
		}
		want := 401
		if i == 10 {
			want = 429
		}
		call("POST", "/auth/login", "", `{"login":"rate_`+schema+`","password":"bad"}`, "", want)
	}
	rejected := call("POST", "/requests/access", "boris", `{"system_code":"grafana","reason":"work"}`, service.ID(), 201)
	offline, err := NewCache("redis://127.0.0.1:1/0")
	if err != nil {
		t.Fatal(err)
	}
	defer offline.Close()
	a.Redis = offline
	start := time.Now()
	call("GET", "/readyz", "", "", "", 200)
	call("POST", "/auth/login", "", `{"login":"intern_anna","password":"test1234"}`, "", 200)
	call("GET", "/onboarding/plan", "anna", "", "", 200)
	call("GET", "/access/overview", "anna", "", "", 200)
	if time.Since(start) >= 2*time.Second {
		t.Fatal("requests stalled while Redis was unavailable")
	}
	a.Redis = cache
	call("POST", "/requests/"+rejected["id"].(string)+"/reject", "elena", `{}`, "", 200)
	savedCorp := svc.Corp
	svc.Corp = &corpclient.HTTP{URL: corp.URL, Token: "wrong", Client: corp.Client()}
	call("POST", "/requests/access", "vera", `{"system_code":"sentry","reason":"work"}`, service.ID(), 503)
	call("GET", "/requests/"+id, "anna", "", "", 503)
	svc.Corp = savedCorp
	syncReq := call("POST", "/requests/access", "boris", `{"system_code":"kafka","reason":"work"}`, service.ID(), 201)
	_, e = db.Exec(ctx, `UPDATE corp_requests SET data=jsonb_set(data,'{status}','"approved"') WHERE id=$1`, syncReq["external_id"])
	if e != nil {
		t.Fatal(e)
	}
	synced := call("GET", "/requests/"+syncReq["id"].(string), "boris", "", "", 200)
	if synced["status"] != "approved" {
		t.Fatal("status not synchronized")
	}

	if e = store.ResetDemo(ctx); e != nil {
		t.Fatal(e)
	}
	resetPlan, e := store.Plan(ctx, "anna")
	if e != nil || resetPlan[0].Tasks[2].Status != "todo" {
		t.Fatal("reset did not restore tasks", e)
	}
	var requestCount int
	if e = db.QueryRow(ctx, "SELECT count(*) FROM requests").Scan(&requestCount); e != nil || requestCount != 2 {
		t.Fatal("reset requests", requestCount, e)
	}

}
