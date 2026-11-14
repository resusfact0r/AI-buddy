package store

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis — реализация Store поверх Redis.
type Redis struct {
	C *redis.Client

	mu        sync.Mutex
	downUntil time.Time
}

// ErrUnavailable — Redis недавно не отвечал; запросы к нему временно не выполняются.
var ErrUnavailable = errors.New("redis unavailable")

// breakFor — на сколько после сбоя агент перестаёт обращаться к Redis,
// чтобы каждый запрос пользователя не ждал таймаута.
const breakFor = 10 * time.Second

// ready сообщает, можно ли сейчас обращаться к Redis.
func (r *Redis) ready() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return time.Now().After(r.downUntil)
}

// note запоминает сбой соединения (отсутствие ключа сбоем не считается).
func (r *Redis) note(err error) error {
	if err != nil && !errors.Is(err, redis.Nil) {
		r.mu.Lock()
		r.downUntil = time.Now().Add(breakFor)
		r.mu.Unlock()
	}
	return err
}

// NewRedis подключается по URL вида redis://host:6379/0.
func NewRedis(url string) (*Redis, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	// Redis — вспомогательное хранилище: его отказ не должен подвешивать чат.
	// По умолчанию клиент пять раз по пять секунд пытается подключиться на КАЖДУЮ операцию.
	opt.DialTimeout = time.Second
	opt.ReadTimeout = time.Second
	opt.WriteTimeout = time.Second
	opt.PoolTimeout = 2 * time.Second
	opt.MaxRetries = 1
	opt.DialerRetries = 1
	opt.ContextTimeoutEnabled = true
	return &Redis{C: redis.NewClient(opt)}, nil
}

// opTimeout — потолок на одну операцию с Redis.
const opTimeout = 1500 * time.Millisecond

func bound(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, opTimeout)
}

// Ping проверяет соединение.
func (r *Redis) Ping(ctx context.Context) error { return r.C.Ping(ctx).Err() }

const prefix = "aibuddy:"

func (r *Redis) SaveAction(ctx context.Context, a *Action, ttl time.Duration) error {
	ctx, cancel := bound(ctx)
	defer cancel()
	data, err := json.Marshal(a)
	if err != nil {
		return err
	}
	if !r.ready() {
		return ErrUnavailable
	}
	return r.note(r.C.Set(ctx, prefix+"action:"+a.ID, data, ttl).Err())
}

func (r *Redis) GetAction(ctx context.Context, id string) (*Action, error) {
	ctx, cancel := bound(ctx)
	defer cancel()
	if !r.ready() {
		return nil, ErrUnavailable
	}
	data, err := r.C.Get(ctx, prefix+"action:"+id).Bytes()
	_ = r.note(err)
	if errors.Is(err, redis.Nil) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var a Action
	if err := json.Unmarshal(data, &a); err != nil {
		return nil, err
	}
	return &a, nil
}

func (r *Redis) Lock(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	ctx, cancel := bound(ctx)
	defer cancel()
	if !r.ready() {
		return false, ErrUnavailable
	}
	ok, err := r.C.SetNX(ctx, prefix+"lock:"+key, 1, ttl).Result()
	return ok, r.note(err)
}

func (r *Redis) Unlock(ctx context.Context, key string) {
	ctx, cancel := bound(ctx)
	defer cancel()
	if r.ready() {
		_ = r.note(r.C.Del(ctx, prefix+"lock:"+key).Err())
	}
}

func (r *Redis) AppendHistory(ctx context.Context, conv string, max int, ttl time.Duration, msgs ...Message) error {
	ctx, cancel := bound(ctx)
	defer cancel()
	if !r.ready() {
		return ErrUnavailable
	}
	key := prefix + "hist:" + conv
	pipe := r.C.TxPipeline()
	for _, m := range msgs {
		data, _ := json.Marshal(m)
		pipe.RPush(ctx, key, data)
	}
	if max > 0 {
		pipe.LTrim(ctx, key, int64(-max), -1)
	}
	pipe.Expire(ctx, key, ttl)
	_, err := pipe.Exec(ctx)
	return r.note(err)
}

func (r *Redis) History(ctx context.Context, conv string, limit int) ([]Message, error) {
	ctx, cancel := bound(ctx)
	defer cancel()
	start := int64(0)
	if limit > 0 {
		start = int64(-limit)
	}
	if !r.ready() {
		return nil, ErrUnavailable
	}
	raw, err := r.C.LRange(ctx, prefix+"hist:"+conv, start, -1).Result()
	if err != nil {
		return nil, r.note(err)
	}
	out := make([]Message, 0, len(raw))
	for _, s := range raw {
		var m Message
		if json.Unmarshal([]byte(s), &m) == nil {
			out = append(out, m)
		}
	}
	return out, nil
}

func (r *Redis) Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	ctx, cancel := bound(ctx)
	defer cancel()
	if !r.ready() {
		return true, ErrUnavailable
	}
	k := prefix + "rate:" + key
	n, err := r.C.Incr(ctx, k).Result()
	if err != nil {
		return true, r.note(err)
	}
	if n == 1 {
		r.C.Expire(ctx, k, window)
	}
	return n <= int64(limit), nil
}
