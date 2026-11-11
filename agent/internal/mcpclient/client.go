// Package mcpclient — агент как MCP-клиент своего MCP-сервера (Streamable HTTP).
// В каждый запрос к MCP подставляется JWT пользователя: сервер пробросит его в API Бэкенда 1.
package mcpclient

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"ai-buddy/agent/internal/tools"
)

// Tool — инструмент, как его видит агент.
type Tool struct {
	Name        string
	Description string
	Schema      json.RawMessage
	ReadOnly    bool
}

// Result — результат вызова инструмента.
type Result struct {
	Text      string
	IsError   bool
	Code      string
	Message   string
	Retryable bool
}

// Session — MCP-сессия от имени одного пользователя.
type Session interface {
	Tools() []Tool
	Call(ctx context.Context, name string, args map[string]any, idempotencyKey string) Result
	Close()
}

// Connector открывает сессии.
type Connector interface {
	Connect(ctx context.Context, token string) (Session, error)
}

// HTTP — коннектор к MCP-серверу по Streamable HTTP.
type HTTP struct {
	URL     string
	Timeout time.Duration
	Base    http.RoundTripper
}

type bearer struct {
	token string
	base  http.RoundTripper
}

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.token)
	return b.base.RoundTrip(r)
}

type session struct {
	cs      *mcp.ClientSession
	tools   []Tool
	timeout time.Duration
}

// Connect инициализирует сессию и получает список инструментов (уже отфильтрованный сервером по роли).
func (h *HTTP) Connect(ctx context.Context, token string) (Session, error) {
	base := h.Base
	if base == nil {
		base = http.DefaultTransport
	}
	timeout := h.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "ai-buddy-agent", Version: "1.0.0"}, nil)
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cs, err := client.Connect(cctx, &mcp.StreamableClientTransport{
		Endpoint:             h.URL,
		HTTPClient:           &http.Client{Transport: bearer{token: token, base: base}},
		MaxRetries:           -1,
		DisableStandaloneSSE: true,
	}, nil)
	if err != nil {
		return nil, err
	}
	s := &session{cs: cs, timeout: timeout}
	res, err := cs.ListTools(cctx, nil)
	if err != nil {
		_ = cs.Close()
		return nil, err
	}
	for _, t := range res.Tools {
		schema, _ := json.Marshal(t.InputSchema)
		s.tools = append(s.tools, Tool{Name: t.Name, Description: t.Description, Schema: schema,
			ReadOnly: t.Annotations != nil && t.Annotations.ReadOnlyHint})
	}
	return s, nil
}

func (s *session) Tools() []Tool { return s.tools }

func (s *session) Close() { _ = s.cs.Close() }

// Call вызывает инструмент с таймаутом; idempotencyKey уходит в _meta и дальше в Idempotency-Key API.
func (s *session) Call(ctx context.Context, name string, args map[string]any, idempotencyKey string) Result {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	if args == nil {
		args = map[string]any{}
	}
	params := &mcp.CallToolParams{Name: name, Arguments: args}
	if idempotencyKey != "" {
		params.Meta = mcp.Meta{tools.MetaIdempotencyKey: idempotencyKey}
	}
	res, err := s.cs.CallTool(ctx, params)
	if err != nil {
		if ctx.Err() != nil {
			return Result{IsError: true, Code: "timeout", Retryable: true,
				Message: "Сервис не ответил за отведённое время. Можно повторить попытку."}
		}
		return Result{IsError: true, Code: "tool_unavailable", Retryable: true,
			Message: "Инструмент временно недоступен. Можно повторить попытку."}
	}
	var sb strings.Builder
	for _, c := range res.Content {
		if t, ok := c.(*mcp.TextContent); ok {
			sb.WriteString(t.Text)
		}
	}
	out := Result{Text: sb.String(), IsError: res.IsError}
	if res.IsError {
		if te, ok := tools.ParseError(out.Text); ok {
			out.Code, out.Message, out.Retryable = te.Code, te.Message, te.Retryable
		} else {
			out.Code, out.Message = "invalid_arguments", "Некорректные параметры инструмента: "+out.Text
		}
		out.Text = "ERROR code=" + out.Code + ": " + out.Message
	}
	return out
}
