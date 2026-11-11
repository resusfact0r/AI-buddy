// Command mcp — MCP-сервер AI-buddy (Streamable HTTP, порт 8082; -stdio для отладки).
package main

import (
	"context"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata" // часовые пояса внутри минимального образа

	"ai-buddy/agent/internal/apiclient"
	"ai-buddy/agent/internal/config"
	"ai-buddy/agent/internal/tools"
)

func main() {
	stdio := flag.Bool("stdio", false, "stdio-транспорт (токен пользователя — в MCP_USER_TOKEN)")
	flag.Parse()
	log := slog.New(slog.NewJSONHandler(os.Stderr, nil)).With("service", "mcp")
	cfg := config.Load(nil)
	srv := tools.NewServer(apiclient.New(cfg.APIBaseURL, cfg.ToolTimeout), cfg.ToolTimeout, log)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if *stdio {
		srv.StaticToken = os.Getenv("MCP_USER_TOKEN")
		if err := srv.RunStdio(ctx); err != nil {
			log.Error("stdio server stopped", "err", err.Error())
			os.Exit(1)
		}
		return
	}
	hs := &http.Server{Addr: cfg.MCPAddr, Handler: srv.Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = hs.Shutdown(sctx)
	}()
	log.Info("mcp server started", "addr", cfg.MCPAddr, "api", cfg.APIBaseURL)
	if err := hs.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Error("server failed", "err", err.Error())
		os.Exit(1)
	}
}
