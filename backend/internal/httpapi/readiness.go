package httpapi

import (
	"aibuddy/backend/internal/domain"
	"aibuddy/backend/internal/rbac"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"strings"
)

type dayTask struct {
	Title    string   `json:"title"`
	Blockers []string `json:"blockers"`
}
type internDay struct {
	ID    string    `json:"id"`
	Name  string    `json:"name"`
	Ready int       `json:"ready"`
	Tasks []dayTask `json:"tasks"`
}

func (a *API) firstDay(ctx context.Context, lead domain.User) (any, error) {
	if lead.Role != "lead" {
		return nil, domain.Err(403, "forbidden", "Проверка доступна руководителю команды")
	}
	rows, err := a.Store.DB.Query(ctx, "SELECT id,full_name FROM users WHERE team_id=$1 AND role='intern' ORDER BY full_name,id", lead.TeamID)
	if err != nil {
		return nil, err
	}
	interns, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (internDay, error) {
		p := internDay{Tasks: []dayTask{}}
		err := r.Scan(&p.ID, &p.Name)
		return p, err
	})
	if err != nil {
		return nil, err
	}
	for i := range interns {
		p := &interns[i]
		stages, err := a.Store.Plan(ctx, p.ID)
		if err != nil {
			return nil, err
		}
		if len(stages) == 0 {
			continue
		}
		access, err := a.Service.Overview(ctx, domain.User{ID: p.ID, TeamID: lead.TeamID, Role: "intern"})
		if err != nil {
			return nil, err
		}
		for _, task := range stages[0].Tasks {
			item := dayTask{Title: task.Title, Blockers: []string{}}
			if task.Status == "blocked" {
				reason := "Стажёр отметил задачу как заблокированную"
				if comment := strings.TrimSpace(task.Comment); comment != "" {
					reason += ": " + comment
				}
				item.Blockers = append(item.Blockers, reason)
			}
			if task.Code == "get_access" {
				for _, s := range access {
					if s["required"] != true {
						continue
					}
					title, _ := s["title"].(string)
					switch s["status"] {
					case "missing":
						item.Blockers = append(item.Blockers, title+" — стажёру нужно запросить доступ")
					case "requested":
						item.Blockers = append(item.Blockers, title+" — заявка ждёт согласования")
					}
				}
			}
			if strings.HasPrefix(task.Link, "/knowledge/") {
				var doc domain.Article
				err := a.Store.Get(ctx, "knowledge_articles", strings.TrimPrefix(task.Link, "/knowledge/"), &doc)
				switch {
				case errors.Is(err, pgx.ErrNoRows):
					item.Blockers = append(item.Blockers, "Инструкция отсутствует — обновите ссылку в плане")
				case err != nil:
					return nil, err
				case !rbac.Can(domain.User{ID: p.ID, TeamID: lead.TeamID}, "knowledge", domain.Resource{TeamID: doc.TeamID}):
					item.Blockers = append(item.Blockers, "Инструкция закрыта для команды стажёра — замените ссылку или уточните права")
				}
			}
			if len(item.Blockers) == 0 {
				p.Ready++
			}
			p.Tasks = append(p.Tasks, item)
		}
	}
	return map[string]any{"interns": interns}, nil
}
