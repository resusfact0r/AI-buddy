package corpmock

import (
	"aibuddy/backend/internal/domain"
	"crypto/subtle"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"math/rand"
	"net/http"
	"strings"
	"time"
)

func Handler(db *pgxpool.Pool, token string, rate float64) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/healthz" {
			w.Write([]byte(`{"status":"ok"}`))
			return
		}
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			http.Error(w, `{"error":{"code":"unauthorized"}}`, http.StatusUnauthorized)
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-time.After(time.Duration(200+rand.Intn(401)) * time.Millisecond):
		}
		if r.Header.Get("X-Mock-Fail") == "true" || rand.Float64() < rate {
			http.Error(w, `{"error":{"code":"upstream_unavailable"}}`, http.StatusServiceUnavailable)
			return
		}
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if r.Method == "GET" && r.URL.Path == "/access/systems" {
			json.NewEncoder(w).Encode([]string{"gitlab", "kafka", "grafana", "storybook", "sentry"})
			return
		}
		if len(parts) < 2 || (parts[0] != "absence" && parts[0] != "access") || parts[1] != "requests" {
			http.NotFound(w, r)
			return
		}
		var req domain.Request
		var data []byte
		switch {
		case len(parts) == 2 && r.Method == "POST":
			if json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536)).Decode(&req) != nil || req.ID == "" || req.UserID == "" {
				http.Error(w, "invalid body", http.StatusBadRequest)
				return
			}
			req.Status = "pending"
			data, _ = json.Marshal(req)
			_, e := db.Exec(r.Context(), "INSERT INTO corp_requests VALUES($1,$2) ON CONFLICT(id) DO NOTHING", req.ID, data)
			if e != nil {
				http.Error(w, "storage unavailable", http.StatusServiceUnavailable)
				return
			}
			e = db.QueryRow(r.Context(), "SELECT data FROM corp_requests WHERE id=$1", req.ID).Scan(&data)
			if e != nil {
				http.Error(w, "storage unavailable", http.StatusServiceUnavailable)
				return
			}
		case len(parts) == 3 && r.Method == "GET":
			if db.QueryRow(r.Context(), "SELECT data FROM corp_requests WHERE id=$1", parts[2]).Scan(&data) != nil {
				http.NotFound(w, r)
				return
			}
		case len(parts) == 4 && parts[3] == "decision" && r.Method == "POST":
			if json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536)).Decode(&req) != nil || (req.Status != "approved" && req.Status != "rejected") {
				http.Error(w, "invalid decision", http.StatusBadRequest)
				return
			}
			var old []byte
			if db.QueryRow(r.Context(), "SELECT data FROM corp_requests WHERE id=$1", parts[2]).Scan(&old) != nil {
				http.NotFound(w, r)
				return
			}
			var existing domain.Request
			_ = json.Unmarshal(old, &existing)
			if existing.Status != "pending" && existing.Status != req.Status {
				http.Error(w, "already decided", http.StatusConflict)
				return
			}
			existing.Status = req.Status
			existing.DecidedBy = req.DecidedBy
			existing.DecisionComment = req.DecisionComment
			existing.UpdatedAt = time.Now()
			data, _ = json.Marshal(existing)
			if _, err := db.Exec(r.Context(), "UPDATE corp_requests SET data=$2 WHERE id=$1", parts[2], data); err != nil {
				http.Error(w, "storage unavailable", http.StatusServiceUnavailable)
				return
			}
		default:
			http.NotFound(w, r)
			return
		}
		w.Write(data)
	})
}
