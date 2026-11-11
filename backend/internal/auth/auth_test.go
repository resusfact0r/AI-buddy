package auth

import (
	"strings"
	"testing"
	"time"
)

func TestTokens(t *testing.T) {
	now := time.Unix(100000, 0)
	token := Issue("anna", "secret", now)
	if id, e := Verify(token, "secret", now); e != nil || id != "anna" {
		t.Fatal(id, e)
	}
	for _, v := range []struct {
		token, key string
		now        time.Time
	}{{token, "other", now}, {token, "secret", now.Add(12 * time.Hour)}, {"bad", "secret", now}, {strings.Replace(token, ".", "x", 1), "secret", now}, {"e30.e30." + sign("e30.e30", "secret"), "secret", now}} {
		if _, e := Verify(v.token, v.key, v.now); e == nil {
			t.Fatal("accepted invalid token")
		}
	}
}
