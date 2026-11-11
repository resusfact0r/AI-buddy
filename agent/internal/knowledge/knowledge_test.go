package knowledge

import "testing"

func TestTracker(t *testing.T) {
	var tr Tracker
	if tr.Miss() || len(tr.Sources()) != 0 {
		t.Error("пустой трекер")
	}
	tr.ObserveSearch(`{"items":[]}`)
	if !tr.Miss() {
		t.Error("пустой поиск = промах")
	}
	tr.ObserveSearch(`{"items":[{"id":1,"title":"A"},{"id":2,"title":"B"},{"id":1,"title":"A"},{"id":3,"title":"C"},{"id":4,"title":"D"},{"title":"без id"}]}`)
	if tr.Miss() {
		t.Error("после находки промаха нет")
	}
	src := tr.Sources()
	if len(src) != MaxSearchSources || src[0].ID != "1" || src[2].Title != "C" {
		t.Errorf("верх выдачи без дублей: %+v", src)
	}
	// Прочитанные статьи важнее выдачи.
	tr.ObserveArticle(`{"id":2,"title":"B","body":"..."}`)
	tr.ObserveArticle(`{"id":2,"title":"B"}`)
	tr.ObserveArticle(`не json`)
	if src = tr.Sources(); len(src) != 1 || src[0].ID != "2" {
		t.Errorf("источники: %+v", src)
	}
}
