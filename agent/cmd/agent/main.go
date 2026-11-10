// Command agent — сервис ИИ-агента AI-buddy (порт 8081): чат с SSE, карточки действий, подсказки.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata" // часовые пояса внутри минимального образа

	"ai-buddy/agent/internal/apiclient"
	"ai-buddy/agent/internal/config"
	"ai-buddy/agent/internal/httpapi"
	"ai-buddy/agent/internal/llm"
	"ai-buddy/agent/internal/mcpclient"
	"ai-buddy/agent/internal/orchestrator"
	"ai-buddy/agent/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("service", "agent")
	cfg := config.Load(nil)

	var client llm.Client
	if cfg.LLMProvider == "mock" {
		client = &llm.Mock{Delay: 15 * time.Millisecond}
		if cfg.MockFallback {
			log.Warn("LLM_API_KEY не задан: агент запущен в mock-режиме (детерминированный LLM на правилах). Задайте LLM_PROVIDER=openai и LLM_API_KEY для реальной модели.")
		} else {
			log.Info("LLM_PROVIDER=mock: детерминированный LLM на правилах")
		}
	} else {
		client = llm.NewOpenAI(cfg.LLMBaseURL, cfg.LLMModel, cfg.LLMAPIKey, cfg.LLMTimeout)
		log.Info("LLM подключена", "base_url", cfg.LLMBaseURL, "model", cfg.LLMModel)
	}

	st := newStore(cfg, log)
	orch := orchestrator.New(cfg, client,
		&mcpclient.HTTP{URL: cfg.MCPURL, Timeout: cfg.ToolTimeout},
		apiclient.New(cfg.APIBaseURL, cfg.ToolTimeout), st, log)
	srv := &httpapi.Server{Orch: orch, Log: log, CORSOrigins: cfg.CORSOrigins}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	hs := &http.Server{Addr: cfg.AgentAddr, Handler: srv.Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = hs.Shutdown(sctx)
	}()
	log.Info("agent started", "addr", cfg.AgentAddr, "mcp", cfg.MCPURL, "api", cfg.APIBaseURL, "llm", client.Name())
	if err := hs.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Error("server failed", "err", err.Error())
		os.Exit(1)
	}
}

// newStore подключает Redis; если он не задан или недоступен на старте — in-memory
// (состояние не переживёт рестарт, но сервис запустится).
func newStore(cfg config.Config, log *slog.Logger) store.Store {
	if cfg.RedisURL == "" {
		log.Warn("REDIS_URL не задан: pending-действия и история хранятся в памяти процесса")
		return store.NewMemory()
	}
	r, err := store.NewRedis(cfg.RedisURL)
	if err == nil {
		for i := 0; i < 10; i++ {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			err = r.Ping(ctx)
			cancel()
			if err == nil {
				log.Info("redis подключён")
				return r
			}
			time.Sleep(time.Second)
		}
	}
	log.Error("redis недоступен, используется память процесса", "err", err.Error())
	return store.NewMemory()
}
