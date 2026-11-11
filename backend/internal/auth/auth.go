package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type Claims struct {
	Sub string `json:"sub"`
	Exp int64  `json:"exp"`
}

func Issue(id, secret string, now time.Time) string {
	b, _ := json.Marshal(Claims{id, now.Add(12 * time.Hour).Unix()})
	s := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`)) + "." + base64.RawURLEncoding.EncodeToString(b)
	return s + "." + sign(s, secret)
}
func sign(s, key string) string {
	h := hmac.New(sha256.New, []byte(key))
	h.Write([]byte(s))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}
func Verify(token, secret string, now time.Time) (string, error) {
	p := strings.Split(token, ".")
	if len(p) != 3 || !hmac.Equal([]byte(sign(strings.Join(p[:2], "."), secret)), []byte(p[2])) {
		return "", errors.New("invalid token")
	}
	head, e := base64.RawURLEncoding.DecodeString(p[0])
	var h map[string]string
	if e != nil || json.Unmarshal(head, &h) != nil || h["alg"] != "HS256" {
		return "", errors.New("invalid algorithm")
	}
	b, e := base64.RawURLEncoding.DecodeString(p[1])
	var c Claims
	if e != nil || json.Unmarshal(b, &c) != nil || c.Sub == "" || c.Exp <= now.Unix() {
		return "", errors.New("expired token")
	}
	return c.Sub, nil
}
