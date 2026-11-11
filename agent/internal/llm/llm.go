// Package llm — абстракция над LLM: OpenAI-совместимый клиент и детерминированный mock.
package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// Роли сообщений.
const (
	RoleSystem    = "system"
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleTool      = "tool"
)

// Message — сообщение диалога в формате chat completions.
type Message struct {
	Role       string     `json:"role"`
	Content    string     `json:"content"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	Name       string     `json:"name,omitempty"`
}

// ToolCall — запрос модели на вызов инструмента.
type ToolCall struct {
	ID   string
	Name string
	Args json.RawMessage
}

// ToolDef — описание инструмента для модели.
type ToolDef struct {
	Name        string
	Description string
	Schema      json.RawMessage
}

// UserContext — контекст пользователя. Реальной модели он передаётся текстом
// в системном промпте; mock читает его напрямую.
type UserContext struct {
	Today     time.Time
	Name      string
	Role      string
	Team      string
	Stage     string
	Progress  int
	BuddyName string
	LeadName  string
	// Escalate — тема, требующая человека (evaluation|conflict|health|money), если её определил guard.
	Escalate string
}

// Request — один шаг диалога с моделью.
type Request struct {
	Messages []Message
	Tools    []ToolDef
	User     UserContext
}

// Response — ответ модели: текст и/или вызовы инструментов.
type Response struct {
	Content   string
	ToolCalls []ToolCall
}

// Client — LLM-провайдер. onToken вызывается для каждого куска текста ответа.
type Client interface {
	Name() string
	Chat(ctx context.Context, req Request, onToken func(string)) (Response, error)
}

// Error — ошибка провайдера.
type Error struct {
	Status    int
	Retryable bool
	Msg       string
}

func (e *Error) Error() string { return fmt.Sprintf("llm error (status %d): %s", e.Status, e.Msg) }
