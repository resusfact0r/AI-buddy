package evals

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ai-buddy/agent/internal/llm"
)

// Mock-LLM обязан проходить eval-набор полностью: это страховка, что набор и стенд корректны,
// а демо без ключа ведёт себя так же, как описано в specs/.
func TestMockPassesEvalSet(t *testing.T) {
	cases, err := Load(filepath.Join("..", "..", "..", "evals", "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(cases) < 20 || len(cases) > 30 {
		t.Errorf("в наборе должно быть 20–30 кейсов, сейчас %d", len(cases))
	}
	results := Run(context.Background(), &llm.Mock{}, cases)
	for _, r := range results {
		if !r.Passed {
			t.Errorf("%s (%s): %v\nответ: %s\nинструменты: %v", r.Case.ID, r.Case.Spec, r.Failures, r.Text, r.Tools)
		}
		if r.Case.Spec == "" || r.Case.Group == "" {
			t.Errorf("%s: у кейса должны быть spec и group", r.Case.ID)
		}
	}
	passed, total := Summary(results)
	report := Report(results, "mock", "", time.Date(2026, 11, 11, 12, 0, 0, 0, time.UTC))
	for _, want := range []string{"# Отчёт по eval-набору", "LLM: `mock`", "| leave-01-full | AC-01-1 |", "0. Права и защита", "search_knowledge"} {
		if !strings.Contains(report, want) {
			t.Errorf("в отчёте нет %q", want)
		}
	}
	if passed == total && !strings.Contains(report, "(100%)") {
		t.Error("в отчёте должен быть процент прохождения")
	}
}

func TestCheckReportsFailures(t *testing.T) {
	yes := true
	col := &collector{}
	col.Emit("token", map[string]string{"text": "Привет, вот твой план"})
	col.Emit("action_proposal", map[string]any{"type": "leave_request", "params": map[string]any{"date_from": "2026-11-12"}})
	col.Emit("error", map[string]any{"code": "tool_failed"})
	fails := check(Expect{Tools: []string{"search_knowledge"}, NoTools: []string{"find_person"}, Sources: &yes, Proposal: "access_request",
		ContainsAny: []string{"отгул"}, NotContains: []string{"план"}}, col, []string{"find_person"})
	if len(fails) != 7 {
		t.Errorf("ожидалось 7 несоответствий, получено %d: %v", len(fails), fails)
	}
	fails = check(Expect{Proposal: "leave_request", Params: map[string]any{"date_from": "2026-11-13"}}, col, nil)
	if len(fails) != 2 || !strings.Contains(fails[0], "date_from") {
		t.Errorf("несовпадение параметров: %v", fails)
	}
	if fails = check(Expect{Proposal: "none"}, col, nil); len(fails) != 2 {
		t.Errorf("лишняя карточка: %v", fails)
	}
	if fails = check(Expect{Proposal: "task_status"}, &collector{}, nil); len(fails) != 1 {
		t.Errorf("нет карточки: %v", fails)
	}
	report := Report([]Result{{Case: Case{ID: "x", Group: "g", Message: "a|b"}, Failures: []string{"плохо"}}}, "openai", "model-x", time.Now())
	if !strings.Contains(report, "❌ плохо") || !strings.Contains(report, "модель `model-x`") || !strings.Contains(report, "0 из 1 (0%)") {
		t.Errorf("отчёт с провалом: %s", report)
	}
}

func TestLoadErrors(t *testing.T) {
	if _, err := Load("нет-такого-файла.json"); err == nil {
		t.Error("ожидалась ошибка чтения")
	}
	bad := filepath.Join(t.TempDir(), "bad.json")
	_ = os.WriteFile(bad, []byte("{"), 0o600)
	if _, err := Load(bad); err == nil {
		t.Error("ожидалась ошибка разбора")
	}
	// Неизвестный пользователь в кейсе — кейс провален, прогон не падает.
	res := Run(context.Background(), &llm.Mock{}, []Case{{ID: "bad-user", User: "nobody", Message: "привет"},
		{ID: "bad-before", User: "intern_anna", Message: "привет", Before: []Step{{User: "nobody", Message: "x"}}}})
	if res[0].Passed || res[1].Passed {
		t.Errorf("кейсы с неизвестным пользователем должны быть провалены: %+v", res)
	}
}
