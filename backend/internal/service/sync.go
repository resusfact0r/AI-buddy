package service

import (
	"aibuddy/backend/internal/domain"
	"context"
)

func (s *Service) Sync(ctx context.Context, u domain.User, id string) (domain.Request, error) {
	r, e := s.Request(ctx, u, id)
	if e != nil || r.ExternalID == "" || r.Status == "failed" {
		return r, e
	}
	remote, e := s.Corp.Call(ctx, "GET", corpPath(r.Type)+"/"+r.ExternalID, r, false)
	if e != nil {
		return r, &domain.Error{Status: 503, Code: "upstream_unavailable", Message: "Не удалось обновить статус", Details: map[string]bool{"retryable": true}}
	}
	if remote.Status != "pending" && remote.Status != "approved" && remote.Status != "rejected" {
		return r, domain.Err(503, "upstream_unavailable", "Некорректный статус сервиса")
	}
	if remote.Status != r.Status {
		r.Status = remote.Status
		r.UpdatedAt = s.Now()
		if e = s.Repo.SaveRequest(ctx, r); e != nil {
			return r, e
		}
		owner, e := s.Repo.User(ctx, r.UserID)
		if e != nil {
			return r, e
		}
		if r.Type == "access" {
			e = s.CloseAccess(ctx, owner)
		}
		return r, e
	}
	return r, nil
}
