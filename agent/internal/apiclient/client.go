// Package apiclient — ручной HTTP-клиент к основному API Бэкенда 1 (docs/openapi.yaml).
// Каждый вызов выполняется с JWT конкретного пользователя: своего токена у агента нет.
package apiclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Error — нормализованная ошибка API ({"error":{"code","message","details"}}).
type Error struct {
	Status    int
	Code      string
	Message   string
	Retryable bool
}

func (e *Error) Error() string { return fmt.Sprintf("api %d %s: %s", e.Status, e.Code, e.Message) }

// Коды ошибок, которыми оперирует агент.
const (
	CodeUnauthorized = "unauthorized"
	CodeForbidden    = "forbidden"
	CodeNotFound     = "not_found"
	CodeConflict     = "conflict"
	CodeValidation   = "validation_error"
	CodeUpstream     = "upstream_unavailable"
	CodeTimeout      = "timeout"
	CodeInternal     = "internal_error"
)

// Client ходит в API Бэкенда 1.
type Client struct {
	BaseURL string
	HTTP    *http.Client
}

// New создаёт клиент с таймаутом на запрос.
func New(baseURL string, timeout time.Duration) *Client {
	return &Client{BaseURL: strings.TrimRight(baseURL, "/"), HTTP: &http.Client{Timeout: timeout}}
}

// Request — параметры одного вызова.
type Request struct {
	Method         string
	Path           string // относительно /api/v1
	Query          url.Values
	Body           any
	Token          string // JWT пользователя
	IdempotencyKey string
	Headers        map[string]string
}

// Do выполняет запрос и возвращает сырой JSON либо *Error.
func (c *Client) Do(ctx context.Context, r Request) (json.RawMessage, error) {
	u := c.BaseURL + "/api/v1" + r.Path
	if len(r.Query) > 0 {
		u += "?" + r.Query.Encode()
	}
	var body io.Reader
	if r.Body != nil {
		b, err := json.Marshal(r.Body)
		if err != nil {
			return nil, &Error{Code: CodeInternal, Message: "не удалось сформировать запрос"}
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, r.Method, u, body)
	if err != nil {
		return nil, &Error{Code: CodeInternal, Message: "некорректный адрес API"}
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if r.Token != "" {
		req.Header.Set("Authorization", "Bearer "+r.Token)
	}
	if r.IdempotencyKey != "" {
		req.Header.Set("Idempotency-Key", r.IdempotencyKey)
	}
	for k, v := range r.Headers {
		req.Header.Set(k, v)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		var ne interface{ Timeout() bool }
		if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &ne) && ne.Timeout()) {
			return nil, &Error{Code: CodeTimeout, Message: "сервис не ответил вовремя", Retryable: true}
		}
		return nil, &Error{Code: CodeUpstream, Message: "сервис недоступен", Retryable: true}
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if len(bytes.TrimSpace(data)) == 0 {
			return json.RawMessage(`{}`), nil
		}
		return data, nil
	}
	return nil, parseError(resp.StatusCode, data)
}

func parseError(status int, data []byte) *Error {
	e := &Error{Status: status}
	var env struct {
		Error struct {
			Code      string `json:"code"`
			Message   string `json:"message"`
			Retryable bool   `json:"retryable"`
			Details   struct {
				Retryable bool `json:"retryable"`
			} `json:"details"`
		} `json:"error"`
		Retryable bool `json:"retryable"`
	}
	if json.Unmarshal(data, &env) == nil {
		e.Code, e.Message = env.Error.Code, env.Error.Message
		e.Retryable = env.Error.Retryable || env.Retryable || env.Error.Details.Retryable
	}
	if e.Code == "" {
		switch {
		case status == 401:
			e.Code = CodeUnauthorized
		case status == 403:
			e.Code = CodeForbidden
		case status == 404:
			e.Code = CodeNotFound
		case status == 409:
			e.Code = CodeConflict
		case status == 400 || status == 422:
			e.Code = CodeValidation
		case status == 502 || status == 503 || status == 504:
			e.Code = CodeUpstream
		default:
			e.Code = CodeInternal
		}
	}
	if status >= 502 && status <= 504 {
		e.Retryable = true
	}
	// Внутренние детали 5xx наружу не отдаём.
	if status >= 500 && e.Code != CodeUpstream {
		e.Message = ""
	}
	return e
}

// AsError приводит ошибку к *Error.
func AsError(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	if err == nil {
		return nil
	}
	return &Error{Code: CodeInternal}
}

// Get — короткая форма GET.
func (c *Client) Get(ctx context.Context, token, path string, q url.Values) (json.RawMessage, error) {
	return c.Do(ctx, Request{Method: http.MethodGet, Path: path, Query: q, Token: token})
}

// ChatMessage — запись истории диалога.
type ChatMessage struct {
	ConversationID string         `json:"conversation_id"`
	Role           string         `json:"role"`
	Content        string         `json:"content"`
	Meta           map[string]any `json:"meta,omitempty"`
}

// SaveMessage сохраняет сообщение в истории Бэкенда 1.
func (c *Client) SaveMessage(ctx context.Context, token string, m ChatMessage) error {
	_, err := c.Do(ctx, Request{Method: http.MethodPost, Path: "/chat/messages", Token: token, Body: m})
	return err
}

// LogEvent пишет событие для метрик пользы.
func (c *Client) LogEvent(ctx context.Context, token, typ string, payload map[string]any) error {
	_, err := c.Do(ctx, Request{Method: http.MethodPost, Path: "/events", Token: token,
		Body: map[string]any{"type": typ, "payload": payload}})
	return err
}

// Me возвращает текущего пользователя (GET /auth/me).
func (c *Client) Me(ctx context.Context, token string) (json.RawMessage, error) {
	return c.Get(ctx, token, "/auth/me", nil)
}
