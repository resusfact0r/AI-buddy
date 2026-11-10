package corpclient

import (
	"aibuddy/backend/internal/domain"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client interface {
	Call(context.Context, string, string, domain.Request, bool) (domain.Request, error)
}
type HTTP struct {
	URL    string
	Token  string
	Client *http.Client
}

func (c *HTTP) Call(ctx context.Context, method, path string, in domain.Request, fail bool) (domain.Request, error) {
	var out domain.Request
	body, e := json.Marshal(in)
	if e != nil {
		return out, e
	}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return out, ctx.Err()
			case <-time.After(time.Duration(attempt) * 100 * time.Millisecond):
			}
		}
		req, e := http.NewRequestWithContext(ctx, method, c.URL+path, bytes.NewReader(body))
		if e != nil {
			return out, e
		}
		req.Header.Set("Authorization", "Bearer "+c.Token)
		req.Header.Set("Content-Type", "application/json")
		if fail {
			req.Header.Set("X-Mock-Fail", "true")
		}
		res, err := c.Client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		b, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		res.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		if res.StatusCode >= 500 {
			lastErr = fmt.Errorf("upstream status %d", res.StatusCode)
			continue
		}
		if res.StatusCode >= 400 {
			return out, fmt.Errorf("upstream status %d", res.StatusCode)
		}
		e = json.Unmarshal(b, &out)
		return out, e
	}
	return out, lastErr
}
