package tools

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"ai-buddy/agent/internal/apiclient"
	"ai-buddy/agent/internal/jsonx"
)

// MetaIdempotencyKey — ключ в _meta вызова инструмента: его агент заполняет action_id.
const MetaIdempotencyKey = "idempotency_key"

// Server — MCP-сервер AI-buddy.
type Server struct {
	API     *apiclient.Client
	Timeout time.Duration
	Log     *slog.Logger
	// StaticToken используется в stdio-режиме, где нет HTTP-заголовков.
	StaticToken string

	mu      sync.Mutex
	servers map[string]*mcp.Server
	roles   map[[32]byte]roleEntry
}

type roleEntry struct {
	role string
	exp  time.Time
}

// NewServer создаёт MCP-сервер поверх API Бэкенда 1.
func NewServer(api *apiclient.Client, timeout time.Duration, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	return &Server{API: api, Timeout: timeout, Log: log,
		servers: map[string]*mcp.Server{}, roles: map[[32]byte]roleEntry{}}
}

// BearerToken достаёт JWT из заголовка Authorization.
func BearerToken(h http.Header) string {
	v := h.Get("Authorization")
	if len(v) > 7 && strings.EqualFold(v[:7], "bearer ") {
		return strings.TrimSpace(v[7:])
	}
	return ""
}

// roleFor узнаёт роль по токену через GET /auth/me (кэш 60 с).
// Это только фильтр видимости инструментов: права всё равно проверяет Бэкенд 1.
func (s *Server) roleFor(ctx context.Context, token string) string {
	if token == "" {
		return ""
	}
	key := sha256.Sum256([]byte(token))
	s.mu.Lock()
	e, ok := s.roles[key]
	s.mu.Unlock()
	if ok && time.Now().Before(e.exp) {
		return e.role
	}
	ctx, cancel := context.WithTimeout(ctx, s.Timeout)
	defer cancel()
	raw, err := s.API.Me(ctx, token)
	if err != nil {
		return ""
	}
	me := jsonx.Object(jsonx.Parse(raw))
	role := jsonx.Str(me, "role")
	if role == "" {
		role = jsonx.Str(jsonx.Get(me, "user"), "role")
	}
	s.mu.Lock()
	if len(s.roles) > 10000 {
		s.roles = map[[32]byte]roleEntry{}
	}
	s.roles[key] = roleEntry{role: role, exp: time.Now().Add(time.Minute)}
	s.mu.Unlock()
	return role
}

// MCPServer возвращает (и кэширует) сервер с набором инструментов для роли.
func (s *Server) MCPServer(role string) *mcp.Server {
	s.mu.Lock()
	defer s.mu.Unlock()
	if srv, ok := s.servers[role]; ok {
		return srv
	}
	srv := mcp.NewServer(&mcp.Implementation{Name: "ai-buddy-mcp", Title: "AI-buddy: корпоративные сервисы", Version: "1.0.0"},
		&mcp.ServerOptions{Instructions: "Инструменты AI-buddy для стажёра: профиль, команда, план адаптации, база знаний, заявки. " +
			"Все вызовы выполняются с правами пользователя, чей JWT передан в заголовке Authorization. " +
			"Инструменты без readOnlyHint меняют данные и требуют подтверждения пользователя."})
	for _, spec := range ForRole(role) {
		s.register(srv, spec)
	}
	s.servers[role] = srv
	return srv
}

func (s *Server) register(srv *mcp.Server, spec Spec) {
	var schema jsonschema.Schema
	if err := json.Unmarshal([]byte(spec.Schema), &schema); err != nil {
		panic(fmt.Sprintf("tool %s: bad schema: %v", spec.Name, err))
	}
	closed := false
	tool := &mcp.Tool{
		Name: spec.Name, Title: spec.Title, Description: spec.Description, InputSchema: &schema,
		Annotations: &mcp.ToolAnnotations{Title: spec.Title, ReadOnlyHint: spec.ReadOnly,
			IdempotentHint: true, OpenWorldHint: &closed, DestructiveHint: &closed},
	}
	mcp.AddTool(srv, tool, func(ctx context.Context, req *mcp.CallToolRequest, args map[string]any) (*mcp.CallToolResult, any, error) {
		token := s.StaticToken
		if req.Extra != nil && req.Extra.Header != nil {
			if t := BearerToken(req.Extra.Header); t != "" {
				token = t
			}
		}
		idem := ""
		if req.Params != nil {
			idem, _ = req.Params.Meta[MetaIdempotencyKey].(string)
		}
		ctx, cancel := context.WithTimeout(ctx, s.Timeout)
		defer cancel()
		start := time.Now()
		raw, err := spec.Run(ctx, Call{API: s.API, Token: token, Args: args, IdempotencyKey: idem})
		if err != nil {
			te := Normalize(err)
			s.Log.Info("tool call failed", "tool", spec.Name, "code", te.Code, "ms", time.Since(start).Milliseconds())
			return nil, nil, te
		}
		s.Log.Info("tool call", "tool", spec.Name, "ms", time.Since(start).Milliseconds())
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(raw)}}}, nil, nil
	})
}

// Handler — HTTP-обработчик Streamable HTTP (stateless): на каждый запрос набор
// инструментов выбирается по роли владельца JWT.
func (s *Server) Handler() http.Handler {
	h := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		return s.MCPServer(s.roleFor(r.Context(), BearerToken(r.Header)))
	}, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true, DisableLocalhostProtection: true})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","service":"mcp"}`))
	})
	mux.Handle("/mcp", h)
	return mux
}

// RunStdio запускает сервер в stdio-режиме (локальная отладка, MCP Inspector).
func (s *Server) RunStdio(ctx context.Context) error {
	role := s.roleFor(ctx, s.StaticToken)
	return s.MCPServer(role).Run(ctx, &mcp.StdioTransport{})
}
