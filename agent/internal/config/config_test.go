package config

import (
	"testing"
	"time"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestLoadDefaultsAndMockFallback(t *testing.T) {
	c := Load(env(nil))
	if c.AgentAddr != ":8081" || c.MCPAddr != ":8082" || c.MCPURL != "http://localhost:8082/mcp" || c.APIBaseURL != "http://localhost:8080" {
		t.Errorf("адреса: %+v", c)
	}
	if c.ToolTimeout != 5*time.Second || c.RequestTimeout != 30*time.Second || c.MaxToolCalls != 5 ||
		c.HistoryLimit != 10 || c.MaxMessageLen != 2000 || c.PendingTTL != 30*time.Minute {
		t.Errorf("лимиты: %+v", c)
	}
	// Без ключа — автоматически mock.
	if c.LLMProvider != "mock" || !c.MockFallback {
		t.Errorf("без ключа должен включаться mock: %+v", c)
	}
	c = Load(env(map[string]string{"LLM_PROVIDER": "openai"}))
	if c.LLMProvider != "mock" || !c.MockFallback {
		t.Error("openai без ключа → mock")
	}
	c = Load(env(map[string]string{"LLM_PROVIDER": "mock", "LLM_API_KEY": "k"}))
	if c.LLMProvider != "mock" || c.MockFallback {
		t.Error("явный mock — не fallback")
	}
	c = Load(env(map[string]string{"LLM_PROVIDER": "OpenAI", "LLM_API_KEY": "k", "LLM_BASE_URL": "https://llm.example/v1/",
		"LLM_MODEL": "m", "MCP_URL": "http://mcp:8082", "API_BASE_URL": "http://api:8080/", "AGENT_MAX_TOOL_CALLS": "x", "TOOL_TIMEOUT_SEC": "7"}))
	if c.LLMProvider != "openai" || c.MockFallback || c.LLMBaseURL != "https://llm.example/v1" || c.LLMModel != "m" ||
		c.MCPURL != "http://mcp:8082/mcp" || c.APIBaseURL != "http://api:8080" || c.MaxToolCalls != 5 || c.ToolTimeout != 7*time.Second {
		t.Errorf("конфиг из env: %+v", c)
	}
	if Load(nil).AgentAddr == "" {
		t.Error("Load(nil) читает os.Getenv")
	}
}
