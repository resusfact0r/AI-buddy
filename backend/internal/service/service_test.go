package service

import (
	"aibuddy/backend/internal/domain"
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

type memory struct {
	users    map[string]domain.User
	requests map[string]domain.Request
	plans    map[string][]domain.Stage
	team     domain.Team
}

func (m *memory) User(_ context.Context, id string) (domain.User, error) {
	u, ok := m.users[id]
	if !ok {
		return u, errors.New("missing")
	}
	return u, nil
}
func (m *memory) Requests(context.Context) ([]domain.Request, error) {
	a := []domain.Request{}
	for _, r := range m.requests {
		a = append(a, r)
	}
	return a, nil
}
func (m *memory) SaveRequest(_ context.Context, r domain.Request) error {
	m.requests[r.ID] = r
	return nil
}
func (m *memory) Plan(_ context.Context, id string) ([]domain.Stage, error) {
	b, _ := json.Marshal(m.plans[id])
	var p []domain.Stage
	json.Unmarshal(b, &p)
	return p, nil
}
func (m *memory) SavePlan(_ context.Context, id string, p []domain.Stage) error {
	m.plans[id] = p
	return nil
}
func (m *memory) Get(_ context.Context, table, id string, out any) error {
	var v any
	if table == "teams" {
		v = m.team
	} else {
		r, ok := m.requests[id]
		if !ok {
			return errors.New("missing")
		}
		v = r
	}
	b, _ := json.Marshal(v)
	return json.Unmarshal(b, out)
}

type corp struct{ fail bool }

func (c *corp) Call(_ context.Context, _, _ string, r domain.Request, _ bool) (domain.Request, error) {
	if c.fail {
		return r, errors.New("offline")
	}
	return r, nil
}
func fixture() (*Service, *memory, *corp, domain.User) {
	u := domain.User{ID: "anna", Role: "intern", TeamID: "one", BuddyID: "buddy"}
	m := &memory{users: map[string]domain.User{"anna": u, "lead": {ID: "lead", Role: "lead", TeamID: "one"}, "foreign": {ID: "foreign", Role: "lead", TeamID: "two"}}, requests: map[string]domain.Request{}, plans: map[string][]domain.Stage{"anna": {{ID: "1", Tasks: []domain.Task{{ID: "1", Code: "get_access", Required: true, Status: "todo"}, {ID: "2", Code: "docs", Required: true, Status: "todo"}}}}}, team: domain.Team{Tools: []domain.Tool{{Code: "gitlab", Required: true}}}}
	c := &corp{}
	return &Service{Repo: m, Corp: c, Now: func() time.Time { return time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC) }}, m, c, u
}
func TestLeaveValidation(t *testing.T) {
	now := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		from, to, reason string
		ok               bool
	}{{"2026-11-11", "2026-11-24", "vacation", true}, {"2026-11-10", "2026-11-11", "day_off", false}, {"2026-11-11", "2026-11-25", "vacation", false}, {"bad", "bad", "day_off", false}, {"2026-11-12", "2026-11-11", "day_off", false}, {"2026-11-11", "2026-11-11", "bad", false}} {
		e := ValidateLeave(map[string]string{"date_from": tc.from, "date_to": tc.to, "reason_type": tc.reason}, now, nil)
		if (e == nil) != tc.ok {
			t.Fatalf("%+v: %v", tc, e)
		}
	}
	p := map[string]string{"date_from": "2026-11-11", "date_to": "2026-11-12", "reason_type": "day_off"}
	if ValidateLeave(p, now, []domain.Request{{Type: "leave", Status: "pending", Payload: p}}) == nil {
		t.Fatal("overlap accepted")
	}
}
func TestAccessWorkflow(t *testing.T) {
	s, m, _, u := fixture()
	ctx := context.Background()
	overview, e := s.Overview(ctx, u)
	if e != nil || overview[0]["status"] != "missing" {
		t.Fatal(overview, e)
	}
	r, e := s.Create(ctx, u, "access", map[string]string{"system_code": "gitlab", "reason": "work"}, false)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Create(ctx, u, "access", r.Payload, false); e == nil {
		t.Fatal("duplicate")
	}
	if _, e = s.Decision(ctx, u, r.ID, "approved", "", false); e == nil {
		t.Fatal("intern approved")
	}
	if _, e = s.Decision(ctx, m.users["foreign"], r.ID, "approved", "", false); e == nil {
		t.Fatal("foreign approved")
	}
	if _, e = s.Decision(ctx, m.users["lead"], r.ID, "approved", "ok", false); e != nil {
		t.Fatal(e)
	}
	if m.plans[u.ID][0].Tasks[0].Status != "done" {
		t.Fatal("access not completed")
	}
	overview, e = s.Overview(ctx, u)
	if e != nil || overview[0]["status"] != "granted" {
		t.Fatal(overview, e)
	}
	if _, e = s.Decision(ctx, m.users["lead"], r.ID, "approved", "", false); e == nil {
		t.Fatal("double decision")
	}
}
func TestFailuresAndPermissions(t *testing.T) {
	s, m, c, u := fixture()
	ctx := context.Background()
	if _, e := s.Create(ctx, u, "access", map[string]string{"system_code": "unknown", "reason": "x"}, false); e == nil {
		t.Fatal("unknown accepted")
	}
	c.fail = true
	r, e := s.Create(ctx, u, "leave", map[string]string{"date_from": "2026-11-12", "date_to": "2026-11-12", "reason_type": "day_off"}, true)
	if e == nil || m.requests[r.ID].Status != "failed" {
		t.Fatal("failure not saved")
	}
	if _, e = s.Request(ctx, u, "missing"); e == nil {
		t.Fatal("missing accepted")
	}
	if _, e = s.Plan(ctx, m.users["foreign"], u.ID); e == nil {
		t.Fatal("foreign plan")
	}
	if _, e = s.Plan(ctx, u, ""); e != nil {
		t.Fatal(e)
	}
	if e = s.Task(ctx, u, "1", "done", ""); e == nil {
		t.Fatal("manual access completion")
	}
	if e = s.Task(ctx, u, "2", "done", "read"); e != nil {
		t.Fatal(e)
	}
	if e = s.Task(ctx, u, "2", "bad", ""); e == nil {
		t.Fatal("bad status")
	}
	if e = s.Task(ctx, m.users["lead"], "2", "done", ""); e == nil {
		t.Fatal("lead edited")
	}
	if e = s.Task(ctx, u, "missing", "done", ""); e == nil {
		t.Fatal("missing task")
	}
	if Progress(m.plans[u.ID])["percent"] != 50 {
		t.Fatal("progress")
	}
	if Progress(nil)["percent"] != 100 {
		t.Fatal("empty progress")
	}
}
func TestOwnApproval(t *testing.T) {
	s, m, _, _ := fixture()
	u := m.users["lead"]
	r := domain.Request{ID: "own", UserID: u.ID, Status: "pending", Type: "leave"}
	m.requests[r.ID] = r
	if _, e := s.Decision(context.Background(), u, r.ID, "approved", "", false); e == nil {
		t.Fatal("approved own")
	}
}
