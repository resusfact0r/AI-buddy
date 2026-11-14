// Package httpapi — HTTP API агента для фронтенда (см. docs/agent-api.md).
package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"ai-buddy/agent/internal/apiclient"
	"ai-buddy/agent/internal/orchestrator"
	"ai-buddy/agent/internal/tools"
)

// Server — HTTP-сервер агента.
type Server struct {
	Orch        *orchestrator.Orchestrator
	Log         *slog.Logger
	CORSOrigins string
}

type errBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, msg string, retryable bool) {
	writeJSON(w, status, map[string]any{"error": errBody{Code: code, Message: msg, Retryable: retryable}})
}

// sse — потокобезопасный отправитель событий SSE.
type sse struct {
	mu sync.Mutex
	w  http.ResponseWriter
	f  http.Flusher
}

func newSSE(w http.ResponseWriter) *sse {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	f, _ := w.(http.Flusher)
	return &sse{w: w, f: f}
}

// Emit отправляет одно событие.
func (s *sse) Emit(event string, data any) {
	payload, err := json.Marshal(data)
	if err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, _ = io.WriteString(s.w, "event: "+event+"\ndata: "+string(payload)+"\n\n")
	if s.f != nil {
		s.f.Flush()
	}
}

// Handler собирает маршруты агента.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok", "service": "agent", "llm": s.Orch.LLM.Name()})
	})
	mux.HandleFunc("POST /api/v1/agent/chat", s.auth(s.chat))
	mux.HandleFunc("POST /api/v1/agent/actions/{id}/confirm", s.auth(s.confirm))
	mux.HandleFunc("POST /api/v1/agent/actions/{id}/cancel", s.auth(s.cancel))
	mux.HandleFunc("GET /api/v1/agent/suggestions", s.auth(func(w http.ResponseWriter, r *http.Request, id orchestrator.Identity, token string) {
		writeJSON(w, 200, map[string]any{"suggestions": s.Orch.Suggestions(r.Context(), id, token)})
	}))
	return s.middleware(mux)
}

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := s.CORSOrigins
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		defer func() {
			// Паника не должна ронять сервис и утекать стектрейсом наружу.
			if rec := recover(); rec != nil {
				s.Log.Error("panic in handler", "path", r.URL.Path, "panic", rec)
				writeErr(w, 500, "internal_error", "Внутренняя ошибка. Попробуй ещё раз.", true)
			}
		}()
		start := time.Now()
		next.ServeHTTP(w, r)
		if r.URL.Path != "/healthz" {
			s.Log.Info("request", "method", r.Method, "path", r.URL.Path, "ms", time.Since(start).Milliseconds())
		}
	})
}

type authed func(w http.ResponseWriter, r *http.Request, id orchestrator.Identity, token string)

// auth проверяет JWT пользователя через Бэкенд 1; без валидного токена агент не работает.
func (s *Server) auth(next authed) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := tools.BearerToken(r.Header)
		if token == "" {
			writeErr(w, 401, "unauthorized", "Требуется авторизация.", false)
			return
		}
		id, err := s.Orch.Identify(r.Context(), token)
		if err != nil {
			e := apiclient.AsError(err)
			if e.Code == apiclient.CodeUnauthorized || e.Code == apiclient.CodeForbidden {
				writeErr(w, 401, "unauthorized", "Сессия истекла или токен недействителен. Войди заново.", false)
				return
			}
			writeErr(w, 503, "upstream_unavailable", "Сервис авторизации временно недоступен. Попробуй ещё раз.", true)
			return
		}
		next(w, r, id, token)
	}
}

func decode(r *http.Request, v any) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		return nil
	}
	return json.Unmarshal(body, v)
}

func (s *Server) chat(w http.ResponseWriter, r *http.Request, id orchestrator.Identity, token string) {
	var in struct {
		Message        string `json:"message"`
		ConversationID string `json:"conversation_id"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, 400, "validation_error", "Некорректный JSON в теле запроса.", false)
		return
	}
	msg := strings.TrimSpace(in.Message)
	switch {
	case msg == "":
		writeErr(w, 400, "validation_error", "Сообщение пустое.", false)
		return
	case utf8.RuneCountInString(msg) > s.Orch.Cfg.MaxMessageLen:
		writeErr(w, 400, "validation_error", "Сообщение слишком длинное: максимум 2000 символов.", false)
		return
	case len(in.ConversationID) > 100:
		writeErr(w, 400, "validation_error", "Некорректный conversation_id.", false)
		return
	case !s.Orch.Allow(r.Context(), id):
		writeErr(w, 429, "rate_limited", "Слишком много сообщений. Подожди минуту и попробуй снова.", true)
		return
	}
	// Контекст запроса отменяется при обрыве соединения — генерация остановится.
	s.Orch.Chat(r.Context(), id, token, in.ConversationID, msg, newSSE(w))
}

func (s *Server) confirm(w http.ResponseWriter, r *http.Request, id orchestrator.Identity, token string) {
	var in struct {
		Params map[string]any `json:"params"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, 400, "validation_error", "Некорректный JSON в теле запроса.", false)
		return
	}
	stream := strings.Contains(r.Header.Get("Accept"), "text/event-stream")
	res, err := s.Orch.Confirm(r.Context(), id, token, r.PathValue("id"), in.Params)
	if err != nil {
		s.actionErr(w, err)
		return
	}
	if !stream {
		writeJSON(w, 200, res)
		return
	}
	em := newSSE(w)
	em.Emit("status", map[string]string{"text": "Выполняю…"})
	em.Emit("action_result", res)
	em.Emit("token", map[string]string{"text": res.Message})
	if res.Error != nil {
		em.Emit("error", res.Error)
	}
	em.Emit("done", map[string]string{"conversation_id": res.ConversationID})
}

func (s *Server) cancel(w http.ResponseWriter, r *http.Request, id orchestrator.Identity, token string) {
	if err := s.Orch.Cancel(r.Context(), id, token, r.PathValue("id")); err != nil {
		s.actionErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"action_id": r.PathValue("id"), "status": "cancelled"})
}

func (s *Server) actionErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, orchestrator.ErrActionNotFound):
		writeErr(w, 404, "action_not_found", "Карточка не найдена.", false)
	case errors.Is(err, orchestrator.ErrActionExpired):
		writeErr(w, 410, "action_expired", "Карточка больше не активна: срок действия истёк или она уже закрыта. Попроси меня подготовить её заново.", false)
	case errors.Is(err, orchestrator.ErrActionBusy):
		writeErr(w, 409, "conflict", "Действие уже выполняется. Подожди пару секунд.", true)
	default:
		// Сюда попадает отказ хранилища карточек: сама карточка не потеряна, запрос можно повторить.
		s.Log.Error("action failed", "err", err.Error())
		writeErr(w, 503, "upstream_unavailable", "Сервис временно недоступен. Карточка сохранена — попробуй ещё раз через минуту.", true)
	}
}
