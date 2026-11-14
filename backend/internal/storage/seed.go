package storage

import (
	"aibuddy/backend/internal/domain"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"time"
)

func (s *Store) Seed(ctx context.Context) error {
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if e = s.seedTx(ctx, tx); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Store) seedTx(ctx context.Context, tx pgx.Tx) error {
	var e error
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(123456)"); e != nil {
		return e
	}
	var count int
	if e = tx.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&count); e != nil {
		return e
	}
	if count > 0 {
		return nil
	}
	teams := []domain.Team{{ID: "delivery", Name: "Команда Доставки", Rules: "Тестовые правила: два ревьюера для Go", Standup: "Тестовый стендап в 10:00", Tools: []domain.Tool{{Code: "gitlab", Title: "GitLab", Purpose: "Код и CI", Required: true}, {Code: "kafka", Title: "Kafka", Purpose: "События", Required: true}, {Code: "grafana", Title: "Grafana", Purpose: "Мониторинг", Required: true}}}, {ID: "frontend", Name: "Команда Фронтенда Объявлений", Rules: "Тестовые правила: один ревьюер и Storybook", Standup: "Тестовый стендап в 11:00", Tools: []domain.Tool{{Code: "gitlab", Title: "GitLab", Purpose: "Код и CI", Required: true}, {Code: "storybook", Title: "Storybook", Purpose: "Компоненты React", Required: true}, {Code: "sentry", Title: "Sentry", Purpose: "Ошибки браузера", Required: true}}}}
	for _, t := range teams {
		t.IsTestData = true
		t.Description = "Синтетическая команда для демо"
		b, _ := json.Marshal(t)
		if _, e = tx.Exec(ctx, "SELECT save_teams($1)", b); e != nil {
			return e
		}
	}
	hash, e := bcrypt.GenerateFromPassword([]byte("test1234"), bcrypt.DefaultCost)
	if e != nil {
		return e
	}
	users := []domain.User{{ID: "anna", Login: "intern_anna", FullName: "Анна", Role: "intern", TeamID: "delivery", BuddyID: "dmitry", LeadID: "elena"}, {ID: "boris", Login: "intern_boris", FullName: "Борис", Role: "intern", TeamID: "delivery", BuddyID: "dmitry", LeadID: "elena"}, {ID: "vera", Login: "intern_vera", FullName: "Вера", Role: "intern", TeamID: "frontend", LeadID: "fedor"}, {ID: "dmitry", Login: "buddy_dmitry", FullName: "Дмитрий", Role: "buddy", TeamID: "delivery", LeadID: "elena"}, {ID: "elena", Login: "lead_elena", FullName: "Елена", Role: "lead", TeamID: "delivery"}, {ID: "fedor", Login: "lead_fedor", FullName: "Фёдор", Role: "lead", TeamID: "frontend"}}
	titles := []string{"Знакомство с командой", "Прочитать документацию", "Получить доступы", "Настроить окружение", "Изучить код-ревью", "Посетить стендап", "Изучить архитектуру", "Запустить тесты", "Выбрать первую задачу", "Открыть merge request", "Пройти ревью", "Проверить мониторинг", "Обсудить прогресс", "Получить обратную связь", "Согласовать следующие цели"}
	for _, u := range users {
		u.StartDate = time.Now().Format("2006-01-02")
		b, _ := json.Marshal(u)
		if _, e = tx.Exec(ctx, "SELECT save_users($1::jsonb || jsonb_build_object('password_hash',$2::text))", b, string(hash)); e != nil {
			return e
		}
		stages := []domain.Stage{}
		for i, name := range []string{"Первый день", "Первая неделя", "Первая задача", "Обратная связь", "Следующие шаги"} {
			st := domain.Stage{ID: fmt.Sprint(i + 1), Ord: i + 1, Title: name, Tasks: []domain.Task{}}
			for j := 0; j < 3; j++ {
				n := i*3 + j
				code := fmt.Sprintf("task_%d", n+1)
				if n == 2 {
					code = "get_access"
				}
				status := "todo"
				if u.ID == "anna" && n < 2 {
					status = "done"
				}
				st.Tasks = append(st.Tasks, domain.Task{ID: fmt.Sprint(n + 1), StageID: st.ID, Code: code, Title: titles[n], Description: "Тестовая задача адаптации; обсудите результат с наставником", Required: true, Status: status})
			}
			if i == 0 {
				st.Tasks[1].Link = "/knowledge/common-4"
			}
			stages = append(stages, st)
		}
		b, _ = json.Marshal(stages)
		if _, e = tx.Exec(ctx, "SELECT save_plan($1,$2)", u.ID, b); e != nil {
			return e
		}
	}
	for i, topic := range []string{"Отгул", "Отпуск", "Адаптация", "Наставник", "Документация", "Доступы", "Обратная связь", "Безопасность"} {
		a := domain.Article{ID: fmt.Sprintf("common-%d", i), Title: topic, Body: "Тестовая инструкция, не регламент Авито. " + topic + ": обсудите вопрос с наставником. Отгул оформляется заявкой с будущими датами на период до 14 дней и согласуется руководителем.", Tags: []string{topic}, IsTestData: true}
		b, _ := json.Marshal(a)
		if _, e = tx.Exec(ctx, "SELECT save_knowledge_articles($1)", b); e != nil {
			return e
		}
	}
	for _, t := range teams {
		topics := []string{"Код-ревью", "Стендап", "Инструменты", "gitlab", "Документация", "Доступы"}
		for i, topic := range topics {
			a := domain.Article{ID: fmt.Sprintf("%s-%d", t.ID, i), TeamID: t.ID, Title: topic + " — " + t.Name, Body: "Тестовая инструкция, не регламент Авито. " + t.Rules + ". " + t.Standup + ". Доступы согласует руководитель команды.", Tags: []string{topic}, IsTestData: true}
			for _, tool := range t.Tools {
				a.Body += " " + tool.Title + ": " + tool.Purpose + "."
			}
			b, _ := json.Marshal(a)
			if _, e = tx.Exec(ctx, "SELECT save_knowledge_articles($1)", b); e != nil {
				return e
			}
		}
	}
	for i, status := range []string{"approved", "pending"} {
		r := domain.Request{ID: fmt.Sprintf("seed-access-%d", i), UserID: "anna", Type: "access", Payload: map[string]string{"system_code": []string{"gitlab", "kafka"}[i], "reason": "Тестовый доступ"}, Status: status, ExternalID: fmt.Sprintf("seed-access-%d", i), CreatedAt: time.Now(), UpdatedAt: time.Now()}
		b, _ := json.Marshal(r)
		if _, e = tx.Exec(ctx, "SELECT save_requests($1)", b); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, "INSERT INTO corp_requests VALUES($1,$2)", r.ID, b); e != nil {
			return e
		}
	}
	return nil
}

func (s *Store) ResetDemo(ctx context.Context) error {
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(814422)"); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, "TRUNCATE login_limits,idempotency,corp_requests,chat_messages,events,requests,user_tasks,onboarding_tasks,onboarding_stages,knowledge_articles,team_tools,users,teams RESTART IDENTITY"); e != nil {
		return e
	}
	if e = s.seedTx(ctx, tx); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
