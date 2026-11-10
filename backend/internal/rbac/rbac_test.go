package rbac

import (
	"aibuddy/backend/internal/domain"
	"testing"
)

func TestMatrix(t *testing.T) {
	for _, role := range []string{"intern", "buddy", "lead"} {
		u := domain.User{ID: "me", Role: role, TeamID: "one"}
		for _, action := range []string{"profile", "create", "chat", "events", "team", "knowledge", "plan", "task", "request", "approve", "pending", "unknown"} {
			for _, relation := range []string{"own", "mentee", "team", "foreign"} {
				r := domain.Resource{UserID: "other", TeamID: "one"}
				if relation == "own" {
					r.UserID = "me"
				}
				if relation == "mentee" {
					r.BuddyID = "me"
				}
				if relation == "foreign" {
					r.TeamID = "two"
				}
				want := false
				switch action {
				case "profile", "create", "chat", "events":
					want = relation == "own"
				case "team", "knowledge":
					want = relation != "foreign"
				case "plan":
					want = relation == "own" || role == "buddy" && relation == "mentee" || role == "lead" && relation != "foreign"
				case "task":
					want = role == "intern" && relation == "own"
				case "request":
					want = relation == "own" || role == "lead" && relation != "foreign"
				case "approve":
					want = role == "lead" && relation != "own" && relation != "foreign"
				case "pending":
					want = role == "lead" && relation != "foreign"
				}
				if got := Can(u, action, r); got != want {
					t.Errorf("%s/%s/%s=%v want %v", role, action, relation, got, want)
				}
			}
		}
	}
}
