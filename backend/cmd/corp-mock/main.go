package main

import (
	"aibuddy/backend/internal/corpmock"

	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"

	"net/http"
	"os"
	"strconv"

	"time"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	db, e := pgxpool.New(context.Background(), os.Getenv("DATABASE_URL"))
	if e != nil {
		slog.Error("db", "error", e)
		os.Exit(1)
	}
	defer db.Close()
	rate, e := strconv.ParseFloat(os.Getenv("CORP_MOCK_FAIL_RATE"), 64)
	if e != nil || rate < 0 || rate > 1 {
		slog.Error("invalid fail rate")
		os.Exit(1)
	}
	token := os.Getenv("CORP_TOKEN")
	if token == "" {
		slog.Error("CORP_TOKEN required")
		os.Exit(1)
	}
	h := corpmock.Handler(db, token, rate)
	server := &http.Server{Addr: ":8090", Handler: h, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second}
	if e = server.ListenAndServe(); e != nil {
		slog.Error("server", "error", e)
		os.Exit(1)
	}
}
