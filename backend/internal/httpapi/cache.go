package httpapi

import (
	"context"
	"encoding/json"
	"github.com/redis/go-redis/v9"
	"time"
)

func NewCache(url string) (*redis.Client, error) {
	if url == "" {
		return nil, nil
	}
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	const budget = 100 * time.Millisecond
	opt.MaxRetries = -1
	opt.DialTimeout, opt.ReadTimeout, opt.WriteTimeout, opt.PoolTimeout = budget, budget, budget, budget
	opt.ContextTimeoutEnabled = true
	return redis.NewClient(opt), nil
}

func (a *API) cached(ctx context.Context, key string, out any) bool {
	if a.Redis == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	b, e := a.Redis.Get(ctx, key).Bytes()
	return e == nil && json.Unmarshal(b, out) == nil
}
func (a *API) cache(ctx context.Context, key string, value any) {
	a.cacheFor(ctx, key, value, 30*time.Second)
}
func (a *API) cacheFor(ctx context.Context, key string, value any, ttl time.Duration) {
	if a.Redis == nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	b, e := json.Marshal(value)
	if e == nil {
		_ = a.Redis.Set(ctx, key, b, ttl).Err()
	}
}
