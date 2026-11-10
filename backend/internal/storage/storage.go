package storage

import (
	"aibuddy/backend/internal/domain"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ DB *pgxpool.Pool }

func (s *Store) User(ctx context.Context, id string) (domain.User, error) {
	var u domain.User
	var b []byte
	err := s.DB.QueryRow(ctx, "SELECT a.data,u.password_hash FROM users u JOIN users_api a USING(id) WHERE id=$1", id).Scan(&b, &u.PasswordHash)
	if err == nil {
		err = json.Unmarshal(b, &u)
	}
	return u, err
}
func (s *Store) Get(ctx context.Context, table, id string, out any) error {
	var b []byte
	err := s.DB.QueryRow(ctx, "SELECT data FROM "+table+"_api WHERE id=$1", id).Scan(&b)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, out)
}
func (s *Store) Requests(ctx context.Context) ([]domain.Request, error) {
	rows, e := s.DB.Query(ctx, "SELECT data FROM requests_api ORDER BY data->>'created_at',id")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	a := []domain.Request{}
	for rows.Next() {
		var b []byte
		var r domain.Request
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, &r); e != nil {
			return nil, e
		}
		a = append(a, r)
	}
	return a, rows.Err()
}
func (s *Store) SaveRequest(ctx context.Context, r domain.Request) error {
	b, e := json.Marshal(r)
	if e != nil {
		return e
	}
	_, e = s.DB.Exec(ctx, "SELECT save_requests($1)", b)
	return e
}
func (s *Store) Plan(ctx context.Context, id string) ([]domain.Stage, error) {
	var b []byte
	a := []domain.Stage{}
	e := s.DB.QueryRow(ctx, "SELECT data FROM user_plans_api WHERE user_id=$1", id).Scan(&b)
	if e == nil {
		e = json.Unmarshal(b, &a)
	}
	return a, e
}
func (s *Store) SavePlan(ctx context.Context, id string, p []domain.Stage) error {
	b, e := json.Marshal(p)
	if e != nil {
		return e
	}
	_, e = s.DB.Exec(ctx, "SELECT save_plan($1,$2)", id, b)
	return e
}
