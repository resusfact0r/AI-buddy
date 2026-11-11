package httpapi

import (
	"aibuddy/backend/internal/domain"
	"aibuddy/backend/internal/storage"
	"context"
	"encoding/json"
)

type idemRepository struct {
	*storage.Store
	key, hash string
}

func (s *idemRepository) SaveRequest(ctx context.Context, r domain.Request) error {
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	b, e := json.Marshal(r)
	if e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, "SELECT save_requests($1)", b); e != nil {
		return e
	}
	if r.Status != "failed" {
		if _, e = tx.Exec(ctx, "INSERT INTO idempotency(user_id,key,body_hash,response) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,key) DO UPDATE SET body_hash=excluded.body_hash,response=excluded.response,created_at=now()", r.UserID, s.key, s.hash, b); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
