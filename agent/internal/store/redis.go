package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis — реализация Store поверх Redis.
type Redis struct {
	C *redis.Client
}

// NewRedis подключается по URL вида redis://host:6379/0.
func NewRedis(url string) (*Redis, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	return &Redis{C: redis.NewClient(opt)}, nil
}

// Ping проверяет соединение.
func (r *Redis) Ping(ctx context.Context) error { return r.C.Ping(ctx).Err() }

const prefix = "aibuddy:"

func (r *Redis) SaveAction(ctx context.Context, a *Action, ttl time.Duration) error {
	data, err := json.Marshal(a)
	if err != nil {
		return err
	}
	return r.C.Set(ctx, prefix+"action:"+a.ID, data, ttl).Err()
}

func (r *Redis) GetAction(ctx context.Context, id string) (*Action, error) {
	data, err := r.C.Get(ctx, prefix+"action:"+id).Bytes()
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
	return r.C.SetNX(ctx, prefix+"lock:"+key, 1, ttl).Result()
}

func (r *Redis) Unlock(ctx context.Context, key string) {
	r.C.Del(ctx, prefix+"lock:"+key)
}

func (r *Redis) AppendHistory(ctx context.Context, conv string, max int, ttl time.Duration, msgs ...Message) error {
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
	return err
}

func (r *Redis) History(ctx context.Context, conv string, limit int) ([]Message, error) {
	start := int64(0)
	if limit > 0 {
		start = int64(-limit)
	}
	raw, err := r.C.LRange(ctx, prefix+"hist:"+conv, start, -1).Result()
	if err != nil {
		return nil, err
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
	k := prefix + "rate:" + key
	n, err := r.C.Incr(ctx, k).Result()
	if err != nil {
		return true, err
	}
	if n == 1 {
		r.C.Expire(ctx, k, window)
	}
	return n <= int64(limit), nil
}
