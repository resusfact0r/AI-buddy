package store

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
)

// Общий набор проверок для обеих реализаций Store.
func suite(t *testing.T, s Store, advance func(time.Duration)) {
	ctx := context.Background()
	a := &Action{ID: "act_1", UserID: "1", Type: "leave_request", Status: StatusPending,
		Params: map[string]any{"date_from": "2026-11-13"}, ExpiresAt: time.Now().Add(30 * time.Minute)}
	if err := s.SaveAction(ctx, a, 30*time.Minute); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetAction(ctx, "act_1")
	if err != nil || got.UserID != "1" || got.Params["date_from"] != "2026-11-13" || got.Status != StatusPending {
		t.Fatalf("GetAction: %+v %v", got, err)
	}
	if _, err := s.GetAction(ctx, "missing"); err != ErrNotFound {
		t.Errorf("ожидался ErrNotFound: %v", err)
	}
	// Pending-действие живёт 30 минут.
	advance(29 * time.Minute)
	if _, err := s.GetAction(ctx, "act_1"); err != nil {
		t.Errorf("через 29 минут действие ещё живо: %v", err)
	}
	advance(2 * time.Minute)
	if _, err := s.GetAction(ctx, "act_1"); err != ErrNotFound {
		t.Errorf("через 31 минуту действие должно истечь: %v", err)
	}

	// Блокировка.
	if ok, _ := s.Lock(ctx, "k", time.Minute); !ok {
		t.Error("первая блокировка должна пройти")
	}
	if ok, _ := s.Lock(ctx, "k", time.Minute); ok {
		t.Error("вторая блокировка должна быть отклонена")
	}
	s.Unlock(ctx, "k")
	if ok, _ := s.Lock(ctx, "k", time.Minute); !ok {
		t.Error("после Unlock блокировка снова доступна")
	}
	advance(2 * time.Minute)
	if ok, _ := s.Lock(ctx, "k", time.Minute); !ok {
		t.Error("блокировка должна истекать по TTL")
	}

	// История: хранится не больше max последних сообщений.
	for i := 0; i < 6; i++ {
		if err := s.AppendHistory(ctx, "1:c", 10, time.Hour, Message{Role: "user", Content: string(rune('a' + i))}, Message{Role: "assistant", Content: "ответ"}); err != nil {
			t.Fatal(err)
		}
	}
	h, err := s.History(ctx, "1:c", 10)
	if err != nil || len(h) != 10 || h[0].Content != "b" || h[9].Role != "assistant" {
		t.Errorf("History: %d %+v %v", len(h), h, err)
	}
	if h, _ = s.History(ctx, "1:c", 3); len(h) != 3 || h[0].Content != "ответ" {
		t.Errorf("History limit: %+v", h)
	}
	if h, _ = s.History(ctx, "other", 10); len(h) != 0 {
		t.Error("чужая история должна быть пустой")
	}

	// Rate limit: не больше limit за окно, затем окно сбрасывается.
	for i := 0; i < 3; i++ {
		if ok, _ := s.Allow(ctx, "u1", 3, time.Minute); !ok {
			t.Errorf("запрос %d должен пройти", i+1)
		}
	}
	if ok, _ := s.Allow(ctx, "u1", 3, time.Minute); ok {
		t.Error("четвёртый запрос должен быть отклонён")
	}
	if ok, _ := s.Allow(ctx, "u2", 3, time.Minute); !ok {
		t.Error("лимит считается по пользователю")
	}
	advance(61 * time.Second)
	if ok, _ := s.Allow(ctx, "u1", 3, time.Minute); !ok {
		t.Error("после окна лимит сбрасывается")
	}
}

func TestMemoryStore(t *testing.T) {
	now := time.Date(2026, 11, 11, 12, 0, 0, 0, time.UTC)
	m := NewMemory()
	m.Now = func() time.Time { return now }
	suite(t, m, func(d time.Duration) { now = now.Add(d) })
}

func TestRedisStore(t *testing.T) {
	mr := miniredis.RunT(t)
	r, err := NewRedis("redis://" + mr.Addr() + "/0")
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Ping(context.Background()); err != nil {
		t.Fatal(err)
	}
	suite(t, r, mr.FastForward)

	// Сбой Redis: ошибки возвращаются, rate limit не блокирует пользователей.
	mr.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, err := r.GetAction(ctx, "x"); err == nil || err == ErrNotFound {
		t.Errorf("ожидалась ошибка соединения: %v", err)
	}
	if ok, err := r.Allow(ctx, "u", 1, time.Minute); !ok || err == nil {
		t.Errorf("при сбое Redis запрос пропускается с ошибкой: %v %v", ok, err)
	}
	if _, err := r.History(ctx, "c", 1); err == nil {
		t.Error("ожидалась ошибка History")
	}
	if _, err := NewRedis("not-a-url"); err == nil {
		t.Error("некорректный URL должен давать ошибку")
	}
}
