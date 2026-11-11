// Package knowledge — учёт источников RAG: какие статьи базы знаний агент нашёл и прочитал
// за один ответ, чтобы показать их пользователю (событие sources) и посчитать метрики.
package knowledge

import "ai-buddy/agent/internal/jsonx"

// Source — ссылка на статью базы знаний.
type Source struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// Tracker накапливает источники за один ответ.
type Tracker struct {
	searched bool
	hits     int
	top      []Source
	read     []Source
}

// MaxSearchSources — сколько статей из выдачи показывать, если агент не открывал статьи целиком.
const MaxSearchSources = 3

// ObserveSearch учитывает результат search_knowledge.
func (t *Tracker) ObserveSearch(raw string) {
	t.searched = true
	items := jsonx.Items(jsonx.Parse([]byte(raw)))
	t.hits += len(items)
	for _, it := range items {
		if len(t.top) >= MaxSearchSources {
			break
		}
		t.top = add(t.top, Source{ID: jsonx.Str(it, "id"), Title: jsonx.Str(it, "title")})
	}
}

// ObserveArticle учитывает результат get_knowledge_article.
func (t *Tracker) ObserveArticle(raw string) {
	a := jsonx.Object(jsonx.Parse([]byte(raw)))
	t.read = add(t.read, Source{ID: jsonx.Str(a, "id"), Title: jsonx.Str(a, "title")})
}

func add(list []Source, s Source) []Source {
	if s.ID == "" {
		return list
	}
	for _, x := range list {
		if x.ID == s.ID {
			return list
		}
	}
	return append(list, s)
}

// Sources возвращает источники ответа: прочитанные статьи, а если их нет — верх поисковой выдачи.
func (t *Tracker) Sources() []Source {
	if len(t.read) > 0 {
		return t.read
	}
	return t.top
}

// Miss сообщает, что поиск был, но в базе знаний ничего не нашлось.
func (t *Tracker) Miss() bool { return t.searched && t.hits == 0 && len(t.read) == 0 }
