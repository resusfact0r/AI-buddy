package domain

import "time"

type User struct {
	ID           string `json:"id"`
	Login        string `json:"login"`
	PasswordHash string `json:"-"`
	FullName     string `json:"full_name"`
	Role         string `json:"role"`
	TeamID       string `json:"team_id"`
	BuddyID      string `json:"buddy_id"`
	LeadID       string `json:"lead_id"`
	StartDate    string `json:"start_date"`
}
type Resource struct{ UserID, TeamID, BuddyID string }
type Tool struct {
	Code     string `json:"system_code"`
	Title    string `json:"title"`
	Purpose  string `json:"purpose"`
	Required bool   `json:"required"`
}
type Team struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Rules       string `json:"rules"`
	Standup     string `json:"standup"`
	DocsURL     string `json:"docs_url"`
	Tools       []Tool `json:"tools"`
	IsTestData  bool   `json:"is_test_data"`
}
type Task struct {
	ID          string `json:"id"`
	StageID     string `json:"stage_id"`
	Code        string `json:"code"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Link        string `json:"link"`
	Required    bool   `json:"required"`
	TeamID      string `json:"team_id,omitempty"`
	Status      string `json:"status"`
	Comment     string `json:"comment"`
}
type Stage struct {
	ID    string `json:"id"`
	Ord   int    `json:"ord"`
	Title string `json:"title"`
	Tasks []Task `json:"tasks"`
}
type Request struct {
	ID              string            `json:"id"`
	UserID          string            `json:"user_id"`
	Type            string            `json:"type"`
	Payload         map[string]string `json:"payload"`
	Status          string            `json:"status"`
	ExternalID      string            `json:"external_id"`
	DecidedBy       string            `json:"decided_by,omitempty"`
	DecisionComment string            `json:"decision_comment,omitempty"`
	CreatedAt       time.Time         `json:"created_at"`
	UpdatedAt       time.Time         `json:"updated_at"`
}
type Article struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Body       string   `json:"body"`
	Tags       []string `json:"tags"`
	TeamID     string   `json:"team_id,omitempty"`
	IsTestData bool     `json:"is_test_data"`
}
type Error struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

func (e *Error) Error() string { return e.Message }
func Err(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}
