// Package jsonx — терпимый к форме разбор JSON-ответов API Бэкенда 1.
// Контракт может немного отличаться (обёртка items/data, числовые или строковые id),
// поэтому агент не привязывается к точным структурам.
package jsonx

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

// Obj — JSON-объект.
type Obj = map[string]any

// Parse разбирает JSON в any, сохраняя числа как json.Number.
func Parse(raw []byte) any {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil
	}
	return v
}

// Object возвращает объект либо пустую карту.
func Object(v any) Obj {
	if m, ok := v.(Obj); ok {
		return m
	}
	return Obj{}
}

// Items достаёт список объектов: сам массив либо поле items/data/results/… объекта.
func Items(v any, keys ...string) []Obj {
	var arr []any
	switch t := v.(type) {
	case []any:
		arr = t
	case Obj:
		for _, k := range append(keys, "items", "data", "results", "tasks") {
			if a, ok := t[k].([]any); ok {
				arr = a
				break
			}
		}
	}
	out := make([]Obj, 0, len(arr))
	for _, it := range arr {
		if m, ok := it.(Obj); ok {
			out = append(out, m)
		}
	}
	return out
}

// Str возвращает строковое представление первого непустого поля из keys.
func Str(m Obj, keys ...string) string {
	for _, k := range keys {
		switch t := m[k].(type) {
		case string:
			if t != "" {
				return t
			}
		case json.Number:
			return t.String()
		case float64:
			return strings.TrimSuffix(fmt.Sprintf("%.0f", t), ".0")
		case bool:
			return fmt.Sprint(t)
		}
	}
	return ""
}

// Get спускается по вложенным объектам: Get(m, "team", "name").
func Get(m Obj, path ...string) Obj {
	cur := m
	for _, p := range path {
		next, ok := cur[p].(Obj)
		if !ok {
			return Obj{}
		}
		cur = next
	}
	return cur
}

// Bool читает булево поле.
func Bool(m Obj, key string) bool {
	b, _ := m[key].(bool)
	return b
}

// Int читает целое поле (0, если его нет).
func Int(m Obj, keys ...string) int {
	for _, k := range keys {
		switch t := m[k].(type) {
		case json.Number:
			if f, err := t.Float64(); err == nil {
				return int(f + 0.5)
			}
		case float64:
			return int(t + 0.5)
		}
	}
	return 0
}
