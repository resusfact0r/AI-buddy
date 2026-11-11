package jsonx

import "testing"

func TestHelpers(t *testing.T) {
	v := Parse([]byte(`{"id":12,"name":"x","flag":true,"f":3.0,"team":{"id":7,"lead":{"full_name":"Елена"}},"items":[{"id":"a"},1,{"id":2}],"systems":[{"system":"vpn"}]}`))
	o := Object(v)
	if Str(o, "missing", "id") != "12" || Str(o, "name") != "x" || Str(o, "flag") != "true" || Str(o, "nope") != "" {
		t.Error("Str")
	}
	if Str(Obj{"f": 3.0}, "f") != "3" || Int(Obj{"f": 2.6}, "f") != 3 || Int(o, "x", "id") != 12 || Int(o, "name") != 0 {
		t.Error("числа")
	}
	if Str(Get(o, "team", "lead"), "full_name") != "Елена" || len(Get(o, "team", "nope", "x")) != 0 {
		t.Error("Get")
	}
	if !Bool(o, "flag") || Bool(o, "name") {
		t.Error("Bool")
	}
	if items := Items(v); len(items) != 2 || Str(items[1], "id") != "2" {
		t.Errorf("Items: %+v", items)
	}
	if items := Items(v, "systems"); len(items) != 1 || Str(items[0], "system") != "vpn" {
		t.Errorf("Items по ключу: %+v", items)
	}
	if len(Items(Parse([]byte(`[{"a":1}]`)))) != 1 || len(Items(Parse([]byte(`"str"`)))) != 0 || len(Items(nil)) != 0 {
		t.Error("Items: массив и не-объекты")
	}
	if Parse([]byte(`{bad`)) != nil || len(Object(nil)) != 0 || len(Object("x")) != 0 {
		t.Error("некорректный JSON")
	}
}
