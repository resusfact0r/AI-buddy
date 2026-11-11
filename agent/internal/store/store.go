// Package store — состояние агента: pending-действия, рабочая история диалога, rate limit, блокировки.
// Основная реализация — Redis; in-memory используется в тестах и как запасной вариант без REDIS_URL.
package store

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"
)

// ErrNotFound — записи нет или истёк TTL.
var ErrNotFound = errors.New("not found")

// Статусы действия.
const (
	StatusPending   = "pending"
	StatusDone      = "done"
	StatusCancelled = "cancelled"
)

// Action — предложенное пользователю действие, ожидающее подтверждения.
type Action struct {
	ID             string          `json:"action_id"`
	UserID         string          `json:"user_id"`
	ConversationID string          `json:"conversation_id"`
	Type           string          `json:"type"`
	Tool           string          `json:"tool"`
	Title          string          `json:"title"`
	Summary        string          `json:"summary"`
	Params         map[string]any  `json:"params"`
	Options        map[string]any  `json:"options,omitempty"`
	Status         string          `json:"status"`
	Attempts       int             `json:"attempts"`
	Result         json.RawMessage `json:"result,omitempty"`
	ExpiresAt      time.Time       `json:"expires_at"`
}

// Message — реплика рабочей истории диалога.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Store — интерфейс хранилища агента.
type Store interface {
	SaveAction(ctx context.Context, a *Action, ttl time.Duration) error
	GetAction(ctx context.Context, id string) (*Action, error)
	// Lock ставит блокировку; false — уже занята.
	Lock(ctx context.Context, key string, ttl time.Duration) (bool, error)
	Unlock(ctx context.Context, key string)
	AppendHistory(ctx context.Context, conv string, max int, ttl time.Duration, msgs ...Message) error
	History(ctx context.Context, conv string, limit int) ([]Message, error)
	// Allow — rate limit: не более limit событий за окно window.
	Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error)
}

// Memory — in-memory реализация Store.
type Memory struct {
	Now func() time.Time

	mu      sync.Mutex
	actions map[string]memItem
	locks   map[string]time.Time
	hist    map[string][]Message
	rate    map[string]*rateBucket
}

type memItem struct {
	data []byte
	exp  time.Time
}

type rateBucket struct {
	count int
	reset time.Time
}

// NewMemory создаёт пустое in-memory хранилище.
func NewMemory() *Memory {
	return &Memory{Now: time.Now, actions: map[string]memItem{}, locks: map[string]time.Time{},
		hist: map[string][]Message{}, rate: map[string]*rateBucket{}}
}

func (m *Memory) SaveAction(_ context.Context, a *Action, ttl time.Duration) error {
	data, err := json.Marshal(a)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.actions[a.ID] = memItem{data: data, exp: m.Now().Add(ttl)}
	return nil
}

func (m *Memory) GetAction(_ context.Context, id string) (*Action, error) {
	m.mu.Lock()
	it, ok := m.actions[id]
	if ok && !m.Now().Before(it.exp) {
		delete(m.actions, id)
		ok = false
	}
	m.mu.Unlock()
	if !ok {
		return nil, ErrNotFound
	}
	var a Action
	if err := json.Unmarshal(it.data, &a); err != nil {
		return nil, err
	}
	return &a, nil
}

func (m *Memory) Lock(_ context.Context, key string, ttl time.Duration) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if exp, ok := m.locks[key]; ok && m.Now().Before(exp) {
		return false, nil
	}
	m.locks[key] = m.Now().Add(ttl)
	return true, nil
}

func (m *Memory) Unlock(_ context.Context, key string) {
	m.mu.Lock()
	delete(m.locks, key)
	m.mu.Unlock()
}

func (m *Memory) AppendHistory(_ context.Context, conv string, max int, _ time.Duration, msgs ...Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	h := append(m.hist[conv], msgs...)
	if max > 0 && len(h) > max {
		h = h[len(h)-max:]
	}
	m.hist[conv] = h
	return nil
}

func (m *Memory) History(_ context.Context, conv string, limit int) ([]Message, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	h := m.hist[conv]
	if limit > 0 && len(h) > limit {
		h = h[len(h)-limit:]
	}
	return append([]Message(nil), h...), nil
}

func (m *Memory) Allow(_ context.Context, key string, limit int, window time.Duration) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.Now()
	b := m.rate[key]
	if b == nil || !now.Before(b.reset) {
		b = &rateBucket{reset: now.Add(window)}
		m.rate[key] = b
	}
	b.count++
	return b.count <= limit, nil
}
