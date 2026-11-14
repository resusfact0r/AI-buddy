package main

import (
	"aibuddy/backend/internal/corpclient"
	"aibuddy/backend/internal/httpapi"
	"aibuddy/backend/internal/service"
	"aibuddy/backend/internal/storage"
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if e := run(); e != nil {
		slog.Error("startup failed", "error", e)
		os.Exit(1)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	secret := os.Getenv("JWT_SECRET")
	if len(secret) < 32 {
		return fmtError("JWT_SECRET must contain at least 32 characters")
	}
	db, e := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		return e
	}
	defer db.Close()
	if e = db.Ping(ctx); e != nil {
		return e
	}
	cache, e := httpapi.NewCache(os.Getenv("REDIS_URL"))
	if e != nil {
		return e
	}
	if cache != nil {
		defer cache.Close()
	}
	store := &storage.Store{DB: db}
	if len(os.Args) == 2 && os.Args[1] == "--reset-demo" {
		if e = store.ResetDemo(ctx); e != nil {
			return e
		}
		if cache != nil {
			return cache.FlushDB(ctx).Err()
		}
		return nil
	}
	if e = store.Seed(ctx); e != nil {
		return e
	}
	corp := &corpclient.HTTP{URL: os.Getenv("CORP_MOCK_URL"), Token: os.Getenv("CORP_TOKEN"), Client: &http.Client{Timeout: 2 * time.Second}}
	svc := &service.Service{Repo: store, Corp: corp, Now: time.Now}
	api := &httpapi.API{Store: store, Service: svc, Redis: cache, Secret: secret}
	server := &http.Server{Addr: ":8080", Handler: api, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	done := make(chan error, 1)
	go func() { done <- server.ListenAndServe() }()
	select {
	case e = <-done:
		if e != http.ErrServerClosed {
			return e
		}
	case <-ctx.Done():
		shutdown, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		return server.Shutdown(shutdown)
	}
	return nil
}

type fmtError string

func (e fmtError) Error() string { return string(e) }
