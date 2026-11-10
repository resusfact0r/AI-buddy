package service

import (
	"aibuddy/backend/internal/corpclient"
	"aibuddy/backend/internal/domain"
	"aibuddy/backend/internal/rbac"
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"
	"time"
)

type Repository interface {
	User(context.Context, string) (domain.User, error)
	Requests(context.Context) ([]domain.Request, error)
	SaveRequest(context.Context, domain.Request) error
	Plan(context.Context, string) ([]domain.Stage, error)
	SavePlan(context.Context, string, []domain.Stage) error
	Get(context.Context, string, string, any) error
}
type Service struct {
	RequestID string
	Repo      Repository
	Corp      corpclient.Client
	Now       func() time.Time
}

func ID() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func Resource(u domain.User) domain.Resource {
	return domain.Resource{UserID: u.ID, TeamID: u.TeamID, BuddyID: u.BuddyID}
}
func ValidateLeave(p map[string]string, now time.Time, existing []domain.Request) error {
	from, e := time.Parse("2006-01-02", p["date_from"])
	to, e2 := time.Parse("2006-01-02", p["date_to"])
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if e != nil || e2 != nil || !from.After(today) || to.Before(from) || to.Sub(from) > 13*24*time.Hour || (p["reason_type"] != "day_off" && p["reason_type"] != "vacation") {
		return domain.Err(400, "validation_error", "Укажите будущие даты, период до 14 дней и корректный reason_type")
	}
	for _, r := range existing {
		if r.Type == "leave" && (r.Status == "pending" || r.Status == "approved") && p["date_from"] <= r.Payload["date_to"] && p["date_to"] >= r.Payload["date_from"] {
			return domain.Err(409, "conflict", "Период пересекается с активной заявкой")
		}
	}
	return nil
}
func (s *Service) Visible(ctx context.Context, u domain.User) ([]domain.Request, error) {
	all, e := s.Repo.Requests(ctx)
	if e != nil {
		return nil, e
	}
	out := []domain.Request{}
	for _, r := range all {
		owner, e := s.Repo.User(ctx, r.UserID)
		if e != nil {
			return nil, e
		}
		if rbac.Can(u, "request", Resource(owner)) {
			out = append(out, r)
		}
	}
	return out, nil
}
func (s *Service) Overview(ctx context.Context, u domain.User) ([]map[string]any, error) {
	var team domain.Team
	if e := s.Repo.Get(ctx, "teams", u.TeamID, &team); e != nil {
		return nil, e
	}
	all, e := s.Repo.Requests(ctx)
	if e != nil {
		return nil, e
	}
	out := []map[string]any{}
	for _, t := range team.Tools {
		status, id := "missing", ""
		for _, r := range all {
			if r.UserID != u.ID || r.Type != "access" || r.Payload["system_code"] != t.Code {
				continue
			}
			if r.Status == "approved" {
				status, id = "granted", r.ID
			} else if r.Status == "pending" && status != "granted" {
				status, id = "requested", r.ID
			}
		}
		out = append(out, map[string]any{"system_code": t.Code, "title": t.Title, "purpose": t.Purpose, "required": t.Required, "status": status, "request_id": id})
	}
	return out, nil
}
func (s *Service) Create(ctx context.Context, u domain.User, kind string, p map[string]string, fail bool) (domain.Request, error) {
	var r domain.Request
	if len(p["comment"]) > 2000 || len(p["reason"]) > 2000 {
		return r, domain.Err(400, "validation_error", "Слишком длинный текст")
	}
	if kind == "leave" {
		all, e := s.Visible(ctx, u)
		if e != nil {
			return r, e
		}
		own := []domain.Request{}
		for _, x := range all {
			if x.UserID == u.ID {
				own = append(own, x)
			}
		}
		if e = ValidateLeave(p, s.Now(), own); e != nil {
			return r, e
		}
	} else {
		items, e := s.Overview(ctx, u)
		if e != nil {
			return r, e
		}
		found := false
		for _, t := range items {
			if t["system_code"] == p["system_code"] {
				found = true
				if t["status"] != "missing" {
					return r, domain.Err(409, "conflict", "Доступ уже выдан или запрошен")
				}
			}
		}
		if !found || strings.TrimSpace(p["reason"]) == "" {
			return r, domain.Err(400, "validation_error", "Нужна система вашей команды и причина")
		}
	}
	r = domain.Request{ID: ID(), UserID: u.ID, Type: kind, Payload: p, Status: "pending", CreatedAt: s.Now(), UpdatedAt: s.Now()}
	if s.RequestID != "" {
		r.ID = s.RequestID
	}
	external, e := s.Corp.Call(ctx, "POST", corpPath(kind), r, fail)
	if e != nil {
		r.Status = "failed"
	} else {
		r.ExternalID = external.ID
	}
	if err := s.Repo.SaveRequest(ctx, r); err != nil {
		return r, err
	}
	if e != nil {
		return r, &domain.Error{Status: 503, Code: "upstream_unavailable", Message: "Корпоративный сервис недоступен", Details: map[string]any{"retryable": true, "request_id": r.ID}}
	}
	return r, nil
}
func corpPath(kind string) string {
	if kind == "leave" {
		return "/absence/requests"
	}
	return "/access/requests"
}
func (s *Service) Request(ctx context.Context, u domain.User, id string) (domain.Request, error) {
	var r domain.Request
	if e := s.Repo.Get(ctx, "requests", id, &r); e != nil {
		return r, domain.Err(404, "not_found", "Заявка не найдена")
	}
	owner, e := s.Repo.User(ctx, r.UserID)
	if e != nil {
		return r, e
	}
	if !rbac.Can(u, "request", Resource(owner)) {
		return domain.Request{}, domain.Err(403, "forbidden", "Нет доступа к заявке")
	}
	return r, nil
}
func (s *Service) Decision(ctx context.Context, u domain.User, id, status, comment string, fail bool) (domain.Request, error) {
	r, e := s.Request(ctx, u, id)
	if e != nil {
		return r, e
	}
	owner, e := s.Repo.User(ctx, r.UserID)
	if e != nil {
		return r, e
	}
	if !rbac.Can(u, "approve", Resource(owner)) {
		return r, domain.Err(403, "forbidden", "Только руководитель команды, кроме своей заявки")
	}
	if r.Status != "pending" {
		return r, domain.Err(409, "conflict", "Заявка уже рассмотрена")
	}
	r.Status = status
	r.DecidedBy = u.ID
	r.DecisionComment = comment
	r.UpdatedAt = s.Now()
	if _, e = s.Corp.Call(ctx, "POST", corpPath(r.Type)+"/"+r.ExternalID+"/decision", r, fail); e != nil {
		return r, &domain.Error{Status: 503, Code: "upstream_unavailable", Message: "Не удалось согласовать", Details: map[string]bool{"retryable": true}}
	}
	if e = s.Repo.SaveRequest(ctx, r); e != nil {
		return r, e
	}
	return r, s.CloseAccess(ctx, owner)
}
func (s *Service) CloseAccess(ctx context.Context, u domain.User) error {
	items, e := s.Overview(ctx, u)
	if e != nil {
		return e
	}
	for _, t := range items {
		if t["required"] == true && t["status"] != "granted" {
			return nil
		}
	}
	p, e := s.Repo.Plan(ctx, u.ID)
	if e != nil {
		return e
	}
	for i := range p {
		for j := range p[i].Tasks {
			if p[i].Tasks[j].Code == "get_access" {
				p[i].Tasks[j].Status = "done"
			}
		}
	}
	return s.Repo.SavePlan(ctx, u.ID, p)
}
func (s *Service) Plan(ctx context.Context, u domain.User, id string) ([]domain.Stage, error) {
	if id == "" {
		id = u.ID
	}
	target, e := s.Repo.User(ctx, id)
	if e != nil {
		return nil, domain.Err(404, "not_found", "Пользователь не найден")
	}
	if !rbac.Can(u, "plan", Resource(target)) {
		return nil, domain.Err(403, "forbidden", "Нет доступа к плану")
	}
	return s.Repo.Plan(ctx, id)
}
func (s *Service) Task(ctx context.Context, u domain.User, id, status, comment string) error {
	if !rbac.Can(u, "task", Resource(u)) {
		return domain.Err(403, "forbidden", "Изменять задачи может только стажёр")
	}
	if status != "todo" && status != "in_progress" && status != "done" && status != "blocked" {
		return domain.Err(400, "validation_error", "Неизвестный статус")
	}
	p, e := s.Repo.Plan(ctx, u.ID)
	if e != nil {
		return e
	}
	for i := range p {
		for j := range p[i].Tasks {
			t := &p[i].Tasks[j]
			if t.ID == id {
				if t.Code == "get_access" {
					return domain.Err(409, "conflict", "Статус доступов изменяется автоматически")
				}
				t.Status = status
				t.Comment = comment
				return s.Repo.SavePlan(ctx, u.ID, p)
			}
		}
	}
	return domain.Err(404, "not_found", "Задача не найдена")
}
func Progress(p []domain.Stage) map[string]any {
	total, done := 0, 0
	stages := []map[string]any{}
	current := ""
	next := []domain.Task{}
	for _, stage := range p {
		n, d := 0, 0
		pending := []domain.Task{}
		for _, t := range stage.Tasks {
			if t.Required {
				n++
				if t.Status == "done" {
					d++
				} else {
					pending = append(pending, t)
				}
			}
		}
		if current == "" && len(pending) > 0 {
			current = stage.ID
			next = pending
			if len(next) > 3 {
				next = next[:3]
			}
		}
		pct := 100
		if n > 0 {
			pct = d * 100 / n
		}
		stages = append(stages, map[string]any{"stage_id": stage.ID, "percent": pct})
		total += n
		done += d
	}
	pct := 100
	if total > 0 {
		pct = done * 100 / total
	}
	return map[string]any{"percent": pct, "stages": stages, "current_stage": current, "next_steps": next}
}
