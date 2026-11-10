package prompts

import (
	"strings"
	"testing"
	"time"

	"ai-buddy/agent/internal/llm"
)

func TestSystemPrompt(t *testing.T) {
	u := llm.UserContext{Today: time.Date(2026, 11, 11, 9, 0, 0, 0, time.UTC), Name: "Анна Соколова", Role: "intern",
		Team: "Доставка", Stage: "Первая неделя", Progress: 30, BuddyName: "Дмитрий Волков", LeadName: "Елена Морозова"}
	p := System(u)
	for _, want := range []string{Canary, "ТЕСТОВЫЕ", "В базе знаний этого нет", "Имя: Анна Соколова", "Роль: стажёр", "Команда: Доставка",
		"Первая неделя (общий прогресс 30%)", "Наставник: Дмитрий Волков", "Руководитель: Елена Морозова",
		"Сегодня: 2026-11-11, 11 ноября (среда)", "2026-11-13 — пятница", "2026-11-25 — среда", "ДАННЫЕ"} {
		if !strings.Contains(p, want) {
			t.Errorf("в промпте нет %q", want)
		}
	}
	if strings.Contains(p, "Важно для этого сообщения") {
		t.Error("подсказка об эскалации только для чувствительных тем")
	}
	u.Escalate, u.BuddyName, u.Stage = "health", "", ""
	p = System(u)
	if !strings.Contains(p, "здоровье и самочувствие") || !strings.Contains(p, "НЕ отвечай по существу") || strings.Contains(p, "Наставник:") || strings.Contains(p, "Текущий этап") {
		t.Error("подсказка об эскалации и пустые поля")
	}
	if RoleRu("lead") != "руководитель" || RoleRu("custom") != "custom" {
		t.Error("RoleRu")
	}
}
