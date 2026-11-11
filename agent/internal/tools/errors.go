package tools

import (
	"fmt"
	"regexp"
	"strings"

	"ai-buddy/agent/internal/apiclient"
)

// ToolError — краткая ошибка для модели: без стектрейсов, токенов и чужих данных.
type ToolError struct {
	Code      string
	Message   string
	Retryable bool
}

// Error кодирует ошибку в текст результата инструмента; агент разбирает его через ParseError.
func (e *ToolError) Error() string {
	return fmt.Sprintf("ERROR code=%s retryable=%t: %s", e.Code, e.Retryable, e.Message)
}

var errRe = regexp.MustCompile(`^ERROR code=([a-z_]+) retryable=(true|false): (.*)`)

// ParseError разбирает текст ошибки инструмента. ok=false, если это не наш формат.
func ParseError(text string) (*ToolError, bool) {
	m := errRe.FindStringSubmatch(strings.TrimSpace(text))
	if m == nil {
		return nil, false
	}
	return &ToolError{Code: m[1], Retryable: m[2] == "true", Message: m[3]}, true
}

var unsafeRe = regexp.MustCompile(`(?i)(eyJ[\w-]{8,}\.[\w-]+\.[\w-]+|bearer\s+\S+|goroutine \d+|panic:|\.go:\d+|SQLSTATE|pq:|pgx)`)

// Normalize превращает ошибку API в короткий безопасный текст для модели.
func Normalize(err error) *ToolError {
	e := apiclient.AsError(err)
	t := &ToolError{Code: e.Code, Retryable: e.Retryable}
	msg := strings.TrimSpace(e.Message)
	if unsafeRe.MatchString(msg) {
		msg = ""
	}
	if r := []rune(msg); len(r) > 300 {
		msg = string(r[:300]) + "…"
	}
	switch e.Code {
	case apiclient.CodeUnauthorized:
		t.Message = "Сессия истекла или пользователь не авторизован. Нужно войти заново."
	case apiclient.CodeForbidden:
		// Текст API не пробрасываем: в нём не должно оказаться чужих данных.
		t.Message = "Недостаточно прав: это действие или эти данные недоступны пользователю."
	case apiclient.CodeNotFound:
		t.Message = "Не найдено или недоступно пользователю."
	case apiclient.CodeValidation, apiclient.CodeConflict:
		t.Message = msg
		if msg == "" {
			t.Message = "Запрос отклонён: проверь параметры."
		}
	case apiclient.CodeUpstream:
		t.Message = "Корпоративный сервис временно недоступен. Можно повторить попытку позже."
		t.Retryable = true
	case apiclient.CodeTimeout:
		t.Message = "Сервис не ответил за отведённое время. Можно повторить попытку."
		t.Retryable = true
	default:
		t.Code = apiclient.CodeInternal
		t.Message = "Внутренняя ошибка сервиса. Можно повторить попытку позже."
		t.Retryable = true
	}
	return t
}
