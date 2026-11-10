// Package dates разбирает относительные русские даты («в пятницу», «завтра»,
// «на следующей неделе во вторник», «с 14 по 16 ноября») в конкретные календарные дни.
package dates

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ISO — формат дат API.
const ISO = "2006-01-02"

var monthStems = []string{"январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"}
var monthsGen = []string{"января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"}
var weekdayNames = []string{"воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"}

const monthAlt = `(январ[яь]|феврал[яь]|марта?|апрел[яь]|ма[яй]|июн[яь]|июл[яь]|августа?|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь])`

var (
	reISO      = regexp.MustCompile(`\b(\d{4})-(\d{2})-(\d{2})\b`)
	reDot      = regexp.MustCompile(`\b(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\b`)
	reDayRange = regexp.MustCompile(`(\d{1,2})\s*(?:-|–|—|по)\s*(\d{1,2})\s+` + monthAlt)
	reDayMonth = regexp.MustCompile(`(\d{1,2})(?:-?го)?\s+` + monthAlt)
	reWeekday  = regexp.MustCompile(`(понедельник|вторник|сред[ауы]|четверг|пятниц|суббот|воскресень)`)
	reRelative = regexp.MustCompile(`(позавчера|послезавтра|вчера|завтра|сегодня)`)
	reInDays   = regexp.MustCompile(`через\s+(\d{1,2})\s+(?:дн|день)`)
)

func day(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func monthIndex(word string) time.Month {
	for i := len(monthStems) - 1; i >= 0; i-- {
		if strings.HasPrefix(word, monthStems[i]) && !(i == 4 && strings.HasPrefix(word, "март")) {
			return time.Month(i + 1)
		}
	}
	return 0
}

func weekdayIndex(stem string) time.Weekday {
	switch {
	case strings.HasPrefix(stem, "понедельник"):
		return time.Monday
	case strings.HasPrefix(stem, "вторник"):
		return time.Tuesday
	case strings.HasPrefix(stem, "сред"):
		return time.Wednesday
	case strings.HasPrefix(stem, "четверг"):
		return time.Thursday
	case strings.HasPrefix(stem, "пятниц"):
		return time.Friday
	case strings.HasPrefix(stem, "суббот"):
		return time.Saturday
	}
	return time.Sunday
}

// futureDate строит дату без года: если день уже прошёл, берётся следующий год.
func futureDate(today time.Time, m time.Month, d int) (time.Time, bool) {
	if m < 1 || m > 12 || d < 1 || d > 31 {
		return time.Time{}, false
	}
	t := time.Date(today.Year(), m, d, 0, 0, 0, 0, time.UTC)
	if t.Day() != d {
		return time.Time{}, false
	}
	if t.Before(today) {
		t = t.AddDate(1, 0, 0)
	}
	return t, true
}

type mention struct {
	pos  int
	date time.Time
}

// Parse находит в тексте дату или диапазон дат относительно today.
// ok=false, если конкретной даты в тексте нет.
func Parse(text string, today time.Time) (from, to time.Time, ok bool) {
	today = day(today)
	s := strings.ReplaceAll(strings.ToLower(text), "ё", "е")
	var ms []mention
	add := func(pos int, t time.Time) { ms = append(ms, mention{pos, t}) }

	for _, m := range reISO.FindAllStringSubmatchIndex(s, -1) {
		if t, err := time.Parse(ISO, s[m[0]:m[1]]); err == nil {
			add(m[0], t)
		}
	}
	s = reISO.ReplaceAllStringFunc(s, func(x string) string { return strings.Repeat(" ", len(x)) })
	for _, m := range reDayRange.FindAllStringSubmatchIndex(s, -1) {
		d1, _ := strconv.Atoi(s[m[2]:m[3]])
		d2, _ := strconv.Atoi(s[m[4]:m[5]])
		mon := monthIndex(s[m[6]:m[7]])
		t1, ok1 := futureDate(today, mon, d1)
		if ok1 {
			t2 := time.Date(t1.Year(), mon, d2, 0, 0, 0, 0, time.UTC)
			if t2.Day() == d2 && !t2.Before(t1) {
				return t1, t2, true
			}
		}
	}
	for _, m := range reDayMonth.FindAllStringSubmatchIndex(s, -1) {
		d, _ := strconv.Atoi(s[m[2]:m[3]])
		if t, ok := futureDate(today, monthIndex(s[m[4]:m[5]]), d); ok {
			add(m[0], t)
		}
	}
	for _, m := range reDot.FindAllStringSubmatchIndex(s, -1) {
		d, _ := strconv.Atoi(s[m[2]:m[3]])
		mon, _ := strconv.Atoi(s[m[4]:m[5]])
		if m[6] >= 0 {
			y, _ := strconv.Atoi(s[m[6]:m[7]])
			t := time.Date(y, time.Month(mon), d, 0, 0, 0, 0, time.UTC)
			if mon >= 1 && mon <= 12 && t.Day() == d {
				add(m[0], t)
			}
		} else if t, ok := futureDate(today, time.Month(mon), d); ok {
			add(m[0], t)
		}
	}
	for _, m := range reRelative.FindAllStringSubmatchIndex(s, -1) {
		switch s[m[2]:m[3]] {
		case "сегодня":
			add(m[0], today)
		case "вчера":
			add(m[0], today.AddDate(0, 0, -1))
		case "позавчера":
			add(m[0], today.AddDate(0, 0, -2))
		case "завтра":
			add(m[0], today.AddDate(0, 0, 1))
		case "послезавтра":
			add(m[0], today.AddDate(0, 0, 2))
		}
	}
	if m := reInDays.FindStringSubmatchIndex(s); m != nil {
		n, _ := strconv.Atoi(s[m[2]:m[3]])
		add(m[0], today.AddDate(0, 0, n))
	} else if i := strings.Index(s, "через неделю"); i >= 0 {
		add(i, today.AddDate(0, 0, 7))
	}

	nextWeek := strings.Contains(s, "следующ")
	// Понедельник следующей недели.
	nextMonday := today.AddDate(0, 0, (8-int(today.Weekday()))%7)
	if today.Weekday() == time.Monday {
		nextMonday = today.AddDate(0, 0, 7)
	}
	var prev time.Time
	for _, m := range reWeekday.FindAllStringSubmatchIndex(s, -1) {
		wd := weekdayIndex(s[m[2]:m[3]])
		var t time.Time
		switch {
		case !prev.IsZero(): // «с понедельника по среду» — второй день после первого
			t = prev.AddDate(0, 0, (int(wd)-int(prev.Weekday())+7)%7)
		case nextWeek:
			t = nextMonday.AddDate(0, 0, (int(wd)+6)%7)
		default:
			diff := (int(wd) - int(today.Weekday()) + 7) % 7
			if diff == 0 {
				diff = 7
			}
			t = today.AddDate(0, 0, diff)
		}
		prev = t
		add(m[0], t)
	}

	if len(ms) == 0 {
		return time.Time{}, time.Time{}, false
	}
	sort.SliceStable(ms, func(i, j int) bool { return ms[i].pos < ms[j].pos })
	from, to = ms[0].date, ms[0].date
	if len(ms) > 1 && ms[1].date.After(from) {
		to = ms[1].date
	}
	return from, to, true
}

// FormatRu форматирует дату: «13 ноября (пятница)».
func FormatRu(t time.Time) string {
	return fmt.Sprintf("%d %s (%s)", t.Day(), monthsGen[t.Month()-1], weekdayNames[t.Weekday()])
}

// FormatISORu форматирует ISO-дату по-русски; при ошибке возвращает исходную строку.
func FormatISORu(iso string) string {
	t, err := time.Parse(ISO, iso)
	if err != nil {
		return iso
	}
	return FormatRu(t)
}

// RangeRu описывает диапазон: «13 ноября (пятница)» или «с 16 ноября (понедельник) по 18 ноября (среда)».
func RangeRu(fromISO, toISO string) string {
	if fromISO == toISO || toISO == "" {
		return FormatISORu(fromISO)
	}
	return "с " + FormatISORu(fromISO) + " по " + FormatISORu(toISO)
}

// Days возвращает число дней в диапазоне включительно (0 при ошибке).
func Days(fromISO, toISO string) int {
	a, e1 := time.Parse(ISO, fromISO)
	b, e2 := time.Parse(ISO, toISO)
	if e1 != nil || e2 != nil || b.Before(a) {
		return 0
	}
	return int(b.Sub(a).Hours()/24) + 1
}

// Calendar — шпаргалка для LLM на ближайшие n дней: модели плохо считают дни недели.
func Calendar(today time.Time, n int) string {
	today = day(today)
	var b strings.Builder
	for i := 0; i < n; i++ {
		t := today.AddDate(0, 0, i)
		fmt.Fprintf(&b, "%s — %s\n", t.Format(ISO), weekdayNames[t.Weekday()])
	}
	return b.String()
}
