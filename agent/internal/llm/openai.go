package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

// OpenAI — клиент любого OpenAI-совместимого API (/chat/completions, stream=true).
type OpenAI struct {
	BaseURL string
	Model   string
	APIKey  string
	HTTP    *http.Client
}

// NewOpenAI создаёт клиент.
func NewOpenAI(baseURL, model, apiKey string, timeout time.Duration) *OpenAI {
	return &OpenAI{BaseURL: strings.TrimRight(baseURL, "/"), Model: model, APIKey: apiKey,
		HTTP: &http.Client{Timeout: timeout}}
}

// Name возвращает имя провайдера.
func (c *OpenAI) Name() string { return "openai" }

type oaToolCall struct {
	Index    int    `json:"index,omitempty"`
	ID       string `json:"id,omitempty"`
	Type     string `json:"type,omitempty"`
	Function struct {
		Name      string `json:"name,omitempty"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type oaMessage struct {
	Role       string       `json:"role"`
	Content    *string      `json:"content"`
	ToolCalls  []oaToolCall `json:"tool_calls,omitempty"`
	ToolCallID string       `json:"tool_call_id,omitempty"`
}

func (c *OpenAI) body(req Request) ([]byte, error) {
	msgs := make([]oaMessage, 0, len(req.Messages))
	for _, m := range req.Messages {
		content := m.Content
		om := oaMessage{Role: m.Role, Content: &content, ToolCallID: m.ToolCallID}
		for _, tc := range m.ToolCalls {
			var otc oaToolCall
			otc.ID, otc.Type = tc.ID, "function"
			otc.Function.Name = tc.Name
			otc.Function.Arguments = string(tc.Args)
			if otc.Function.Arguments == "" {
				otc.Function.Arguments = "{}"
			}
			om.ToolCalls = append(om.ToolCalls, otc)
		}
		if len(om.ToolCalls) > 0 && content == "" {
			om.Content = nil
		}
		msgs = append(msgs, om)
	}
	payload := map[string]any{"model": c.Model, "messages": msgs, "stream": true, "temperature": 0.2}
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, 0, len(req.Tools))
		for _, t := range req.Tools {
			tools = append(tools, map[string]any{"type": "function", "function": map[string]any{
				"name": t.Name, "description": t.Description, "parameters": t.Schema}})
		}
		payload["tools"] = tools
		payload["tool_choice"] = "auto"
	}
	return json.Marshal(payload)
}

// Chat выполняет запрос со стримингом: текст отдаётся в onToken, вызовы инструментов накапливаются.
func (c *OpenAI) Chat(ctx context.Context, req Request, onToken func(string)) (Response, error) {
	body, err := c.body(req)
	if err != nil {
		return Response{}, &Error{Msg: "не удалось сформировать запрос"}
	}
	hr, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return Response{}, &Error{Msg: "некорректный LLM_BASE_URL"}
	}
	hr.Header.Set("Content-Type", "application/json")
	hr.Header.Set("Accept", "text/event-stream")
	if c.APIKey != "" {
		hr.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	resp, err := c.HTTP.Do(hr)
	if err != nil {
		if ctx.Err() != nil && !errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return Response{}, ctx.Err()
		}
		return Response{}, &Error{Retryable: true, Msg: "LLM недоступна или не ответила вовремя"}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
		return Response{}, &Error{Status: resp.StatusCode,
			Retryable: resp.StatusCode >= 500 || resp.StatusCode == 429 || resp.StatusCode == 408,
			Msg:       "LLM вернула ошибку " + resp.Status}
	}

	var out Response
	var content strings.Builder
	calls := map[int]*ToolCall{}
	args := map[int]*strings.Builder{}
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(line[5:])
		if data == "[DONE]" {
			break
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content   string       `json:"content"`
					ToolCalls []oaToolCall `json:"tool_calls"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil || len(chunk.Choices) == 0 {
			continue
		}
		d := chunk.Choices[0].Delta
		if d.Content != "" {
			content.WriteString(d.Content)
			if onToken != nil {
				onToken(d.Content)
			}
		}
		for _, tc := range d.ToolCalls {
			cur, ok := calls[tc.Index]
			if !ok {
				cur = &ToolCall{}
				calls[tc.Index] = cur
				args[tc.Index] = &strings.Builder{}
			}
			if tc.ID != "" {
				cur.ID = tc.ID
			}
			if tc.Function.Name != "" {
				cur.Name += tc.Function.Name
			}
			args[tc.Index].WriteString(tc.Function.Arguments)
		}
	}
	if err := sc.Err(); err != nil {
		return Response{}, &Error{Retryable: content.Len() == 0, Msg: "поток ответа LLM оборвался"}
	}
	idx := make([]int, 0, len(calls))
	for i := range calls {
		idx = append(idx, i)
	}
	sort.Ints(idx)
	for _, i := range idx {
		tc := *calls[i]
		tc.Args = json.RawMessage(args[i].String())
		if len(bytes.TrimSpace(tc.Args)) == 0 || !json.Valid(tc.Args) {
			tc.Args = json.RawMessage(`{}`)
		}
		if tc.ID == "" {
			tc.ID = "call_" + tc.Name
		}
		out.ToolCalls = append(out.ToolCalls, tc)
	}
	out.Content = content.String()
	return out, nil
}
