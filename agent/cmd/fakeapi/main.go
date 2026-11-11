// Command fakeapi — автономная имитация API Бэкенда 1 для локальной разработки агента.
// В общем docker-compose НЕ используется: там работает настоящий backend/cmd/api.
package main

import (
	"log/slog"
	"net/http"
	"os"
	"time"
	_ "time/tzdata" // часовые пояса внутри минимального образа

	"ai-buddy/agent/internal/fakeapi"
)

func main() {
	addr := os.Getenv("FAKEAPI_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	log := slog.New(slog.NewJSONHandler(os.Stderr, nil)).With("service", "fakeapi")
	log.Info("fake backend API started (synthetic data only)", "addr", addr)
	hs := &http.Server{Addr: addr, Handler: fakeapi.New().Handler(), ReadHeaderTimeout: 5 * time.Second}
	if err := hs.ListenAndServe(); err != nil {
		log.Error("server failed", "err", err.Error())
		os.Exit(1)
	}
}
