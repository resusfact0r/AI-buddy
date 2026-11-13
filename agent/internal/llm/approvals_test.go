package llm

import (
	"context"
	"strings"
	"testing"

	"ai-buddy/agent/internal/jsonx"
)

// Настоящий API отдаёт заявки с длинным хеш-идентификатором и user_id без имени:
// агент показывает короткий номер и хотя бы идентификатор автора, а заявку находит по сокращённому номеру.
func TestApprovalsWithRealAPIShape(t *testing.T) {
	const full = "5a5b5e18745387df9108b87a9818c370406c2c55dc43bb5c5de59b1c9dfd7655"
	if ShortID(full) != "5a5b5e18" || ShortID("seed-access-1") != "seed-access-1" {
		t.Error("ShortID")
	}
	req := jsonx.Object(jsonx.Parse([]byte(`{"id":"` + full + `","user_id":"anna","type":"leave","payload":{"date_from":"2026-11-20","date_to":"2026-11-20"}}`)))
	if RequestAuthor(req) != "anna" || RequestAuthor(jsonx.Obj{}) != "сотрудник команды" ||
		RequestAuthor(jsonx.Obj{"user": map[string]any{"full_name": "Анна"}, "user_id": "anna"}) != "Анна" {
		t.Error("RequestAuthor")
	}
	list := `[{"id":"` + full + `","user_id":"anna","type":"leave","payload":{"date_from":"2026-11-20","date_to":"2026-11-20"}}]`
	tools := []ToolDef{{Name: "list_pending_approvals"}, {Name: "approve_request"}, {Name: "reject_request"}}
	run := func(user string, withList bool) Response {
		msgs := []Message{{Role: RoleUser, Content: user}}
		if withList {
			msgs = append(msgs,
				Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "c1", Name: "list_pending_approvals"}}},
				Message{Role: RoleTool, ToolCallID: "c1", Content: list})
		}
		resp, _ := (&Mock{}).Chat(context.Background(), Request{Messages: msgs, Tools: tools, User: UserContext{Role: "lead"}}, nil)
		return resp
	}
	resp := run("Что мне согласовать?", true)
	if !strings.Contains(resp.Content, "№5a5b5e18: Отгул 20 ноября (пятница) — anna") || strings.Contains(resp.Content, full) {
		t.Errorf("список заявок: %q", resp.Content)
	}
	// Сначала агент запрашивает список, затем находит заявку по сокращённому номеру.
	if resp = run("Отклони заявку 5a5b5e18, сейчас релиз", false); len(resp.ToolCalls) != 1 || resp.ToolCalls[0].Name != "list_pending_approvals" {
		t.Fatalf("ожидался запрос списка: %+v", resp)
	}
	resp = run("Отклони заявку 5a5b5e18, сейчас релиз", true)
	if len(resp.ToolCalls) != 1 || resp.ToolCalls[0].Name != "reject_request" ||
		!strings.Contains(string(resp.ToolCalls[0].Args), full) || !strings.Contains(string(resp.ToolCalls[0].Args), "сейчас релиз") {
		t.Errorf("отклонение по короткому номеру: %+v", resp)
	}
	if resp = run("Одобри заявку deadbeef", true); len(resp.ToolCalls) != 0 || !strings.Contains(resp.Content, "Не нашёл заявку") {
		t.Errorf("неизвестный номер: %+v", resp)
	}
	if got := summarize("Тестовая инструкция, не регламент Авито. Отгул оформляется заявкой.", 200); got != "Отгул оформляется заявкой." {
		t.Errorf("summarize: %q", got)
	}
}
