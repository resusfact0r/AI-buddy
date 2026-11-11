// Package config читает настройки сервисов агента из переменных окружения.
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Config — общие настройки agent и mcp.
type Config struct {
	AgentAddr   string
	MCPAddr     string
	APIBaseURL  string
	MCPURL      string
	RedisURL    string
	LLMProvider string // openai | mock
	LLMBaseURL  string
	LLMModel    string
	LLMAPIKey   string
	CORSOrigins string

	ToolTimeout    time.Duration
	RequestTimeout time.Duration
	LLMTimeout     time.Duration
	MaxToolCalls   int
	HistoryLimit   int
	MaxMessageLen  int
	RateLimit      int
	RateWindow     time.Duration
	PendingTTL     time.Duration

	// MockFallback — true, если mock включён автоматически из-за отсутствия ключа.
	MockFallback bool
}

// Load собирает конфиг из окружения; getenv можно подменить в тестах.
func Load(getenv func(string) string) Config {
	if getenv == nil {
		getenv = os.Getenv
	}
	str := func(key, def string) string {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
		return def
	}
	num := func(key string, def int) int {
		if n, err := strconv.Atoi(str(key, "")); err == nil && n > 0 {
			return n
		}
		return def
	}
	sec := func(key string, def int) time.Duration {
		return time.Duration(num(key, def)) * time.Second
	}
	c := Config{
		AgentAddr:      str("AGENT_ADDR", ":8081"),
		MCPAddr:        str("MCP_ADDR", ":8082"),
		APIBaseURL:     strings.TrimRight(str("API_BASE_URL", "http://localhost:8080"), "/"),
		MCPURL:         str("MCP_URL", "http://localhost:8082/mcp"),
		RedisURL:       str("REDIS_URL", ""),
		LLMProvider:    strings.ToLower(str("LLM_PROVIDER", "")),
		LLMBaseURL:     strings.TrimRight(str("LLM_BASE_URL", "https://openrouter.ai/api/v1"), "/"),
		LLMModel:       str("LLM_MODEL", "openai/gpt-4o-mini"),
		LLMAPIKey:      str("LLM_API_KEY", ""),
		CORSOrigins:    str("CORS_ORIGINS", "*"),
		ToolTimeout:    sec("TOOL_TIMEOUT_SEC", 5),
		RequestTimeout: sec("AGENT_TIMEOUT_SEC", 30),
		LLMTimeout:     sec("LLM_TIMEOUT_SEC", 20),
		MaxToolCalls:   num("AGENT_MAX_TOOL_CALLS", 5),
		HistoryLimit:   num("AGENT_HISTORY_LIMIT", 10),
		MaxMessageLen:  num("AGENT_MAX_MESSAGE_LEN", 2000),
		RateLimit:      num("AGENT_RATE_LIMIT", 20),
		RateWindow:     sec("AGENT_RATE_WINDOW_SEC", 60),
		PendingTTL:     sec("AGENT_PENDING_TTL_SEC", 1800),
	}
	if !strings.HasSuffix(c.MCPURL, "/mcp") {
		c.MCPURL = strings.TrimRight(c.MCPURL, "/") + "/mcp"
	}
	// Без ключа проект обязан запускаться: автоматически включаем mock.
	if c.LLMProvider == "" || (c.LLMProvider != "mock" && c.LLMAPIKey == "") {
		c.MockFallback = c.LLMProvider != "mock"
		c.LLMProvider = "mock"
	}
	return c
}
