package rbac

import "aibuddy/backend/internal/domain"

func Can(u domain.User, action string, r domain.Resource) bool {
	switch action {
	case "profile", "create", "chat", "events":
		return u.ID != "" && r.UserID == u.ID
	case "team", "knowledge":
		return u.ID != "" && (r.TeamID == "" || u.TeamID == r.TeamID)
	case "plan":
		return u.ID == r.UserID || u.Role == "buddy" && r.BuddyID == u.ID || u.Role == "lead" && u.TeamID == r.TeamID
	case "task":
		return u.Role == "intern" && u.ID == r.UserID
	case "request":
		return u.ID == r.UserID || u.Role == "lead" && u.TeamID == r.TeamID
	case "approve":
		return u.Role == "lead" && u.TeamID == r.TeamID && u.ID != r.UserID
	case "pending":
		return u.Role == "lead" && u.TeamID == r.TeamID
	}
	return false
}
