package httpapi

import (
	"context"
	"encoding/json"
	"time"
)

func (a *API) cached(ctx context.Context, key string, out any) bool {
	b, e := a.Redis.Get(ctx, key).Bytes()
	return e == nil && json.Unmarshal(b, out) == nil
}
func (a *API) cache(ctx context.Context, key string, value any) {
	b, e := json.Marshal(value)
	if e == nil {
		_ = a.Redis.Set(ctx, key, b, 30*time.Second).Err()
	}
}
