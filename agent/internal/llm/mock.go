package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"

	"ai-buddy/agent/internal/dates"
	"ai-buddy/agent/internal/guard"
	"ai-buddy/agent/internal/jsonx"
)

// Mock — детерминированный «LLM» на правилах. Он проходит все сценарии из specs/
// без ключа и сети: по последнему сообщению определяет намерение, вызывает те же
// MCP-инструменты, что и настоящая модель, и собирает ответ из их результатов.
type Mock struct {
	// Delay — пауза между кусками текста (имитация стриминга).
	Delay time.Duration
}

// Name возвращает имя провайдера.
func (m *Mock) Name() string { return "mock" }

// Chat реализует Client.
func (m *Mock) Chat(ctx context.Context, req Request, onToken func(string)) (Response, error) {
	resp := newTurn(req).decide()
	if onToken != nil && resp.Content != "" {
		for _, chunk := range strings.SplitAfter(resp.Content, " ") {
			if ctx.Err() != nil {
				return Response{}, ctx.Err()
			}
			onToken(chunk)
			if m.Delay > 0 {
				time.Sleep(m.Delay)
			}
		}
	}
	return resp, nil
}

// AskDateMarker — фраза уточняющего вопроса о дате: по ней mock узнаёт продолжение сценария отгула.
const AskDateMarker = "На какую дату"

type turn struct {
	req     Request
	user    string // последнее сообщение пользователя
	low     string // оно же в нижнем регистре, ё→е
	prev    string // предыдущий ответ ассистента
	results map[string][]string
	tools   map[string]bool
	n       int
}

func newTurn(req Request) *turn {
	t := &turn{req: req, results: map[string][]string{}, tools: map[string]bool{}}
	for _, td := range req.Tools {
		t.tools[td.Name] = true
	}
	last := -1
	for i, m := range req.Messages {
		if m.Role == RoleUser {
			last = i
		}
	}
	if last < 0 {
		return t
	}
	t.user = strings.TrimSpace(req.Messages[last].Content)
	t.low = norm(t.user)
	for i := last - 1; i >= 0; i-- {
		if req.Messages[i].Role == RoleAssistant && req.Messages[i].Content != "" {
			t.prev = req.Messages[i].Content
			break
		}
	}
	names := map[string]string{}
	for _, m := range req.Messages[last+1:] {
		switch m.Role {
		case RoleAssistant:
			for _, tc := range m.ToolCalls {
				names[tc.ID] = tc.Name
			}
		case RoleTool:
			name := names[m.ToolCallID]
			t.results[name] = append(t.results[name], guard.UnwrapToolResult(m.Content))
		}
	}
	return t
}

func norm(s string) string { return strings.ReplaceAll(strings.ToLower(s), "ё", "е") }

func (t *turn) has(tool string) bool { return t.tools[tool] }

func (t *turn) result(tool string) (string, bool) {
	r := t.results[tool]
	if len(r) == 0 {
		return "", false
	}
	return r[len(r)-1], true
}

func (t *turn) call(name string, args map[string]any) ToolCall {
	t.n++
	raw, _ := json.Marshal(args)
	return ToolCall{ID: fmt.Sprintf("mock_%s_%d", name, t.n), Name: name, Args: raw}
}

func say(text string) Response { return Response{Content: text} }

func isErr(body string) (code string, ok bool) {
	if !strings.HasPrefix(body, "ERROR") {
		return "", false
	}
	if m := regexp.MustCompile(`code=([a-z_]+)`).FindStringSubmatch(body); m != nil {
		return m[1], true
	}
	return "internal_error", true
}

// errorReply объясняет ошибку инструмента по-человечески.
func errorReply(body string) Response {
	code, _ := isErr(body)
	switch code {
	case "forbidden", "not_found":
		return say("Не могу это показать или сделать: эти данные или действие тебе недоступны. Я работаю только с твоими правами. Если доступ действительно нужен — обратись к руководителю.")
	case "unauthorized":
		return say("Похоже, сессия истекла. Войди, пожалуйста, заново.")
	case "upstream_unavailable", "timeout", "tool_unavailable", "internal_error":
		return say("Сервис сейчас временно недоступен, поэтому данные получить не удалось. Попробуй повторить запрос через минуту.")
	}
	msg := body
	if i := strings.Index(body, ": "); i >= 0 {
		msg = body[i+2:]
	}
	return say("Не получилось: " + msg)
}

var (
	reApprovalsList = regexp.MustCompile(`(что\s+(мне\s+)?(нужно\s+|надо\s+)?согласовать|на\s+согласовани|ждут\s+(моего\s+)?(решени|одобрени|согласовани)|заявки\s+команды|кого\s+согласовать|есть\s+(ли\s+)?заявки)`)
	reApproveCmd    = regexp.MustCompile(`(^|\s)(одобри|одобрить|согласуй|апрувни|подтверди)(\s|$)`)
	reRejectCmd     = regexp.MustCompile(`(^|\s)(отклони|отклонить|откажи)(\s|$)`)
	reNumber        = regexp.MustCompile(`\d+`)
	reOtherPerson   = regexp.MustCompile(`(?:план|прогресс|задач[иу]|заявк[иу]|доступы|данные|профиль|адаптаци[юя])\s+(?:адаптации\s+)?([А-ЯЁ][а-яё]{2,})`)
	reLeave         = regexp.MustCompile(`(отгул|отпуск|выходной\s+за\s+свой|day\s*off|взять\s+день)`)
	reStatusAsk     = regexp.MustCompile(`(одобрили|согласовали|подтвердили|отклонили|статус|что\s+с\s+(моим|моей)|рассмотрели)`)
	reAccess        = regexp.MustCompile(`(доступ)`)
	reTaskDone      = regexp.MustCompile(`(^|\s)я\s+(уже\s+)?(сделал|прочитал|прочел|прошел|прошла|выполнил|закончил|настроил|посетил|изучил|познакомил|собрал|взял|сходил|был[аи]?\s+на|отправил)`)
	reMarkDone      = regexp.MustCompile(`(отметь|закрой|заверши)\s+(задач|как\s+выполн)`)
	reNextSteps     = regexp.MustCompile(`(что\s+(мне\s+)?(еще\s+)?(делать|сделать)|что\s+(мне\s+)?дальше|что\s+дальше|следующ\S+\s+шаг|что\s+(я\s+)?(еще\s+)?не\s+сделал|мой\s+прогресс|прогресс\s+адаптации|какой\s+(у\s+меня\s+)?прогресс|план\s+адаптации|на\s+каком\s+я\s+этапе|с\s+чего\s+начать|чем\s+заняться)`)
	reTeam          = regexp.MustCompile(`(какие\s+(у\s+нас\s+)?(каналы|инструменты|правила)|наши\s+каналы|стек\s+команды|о\s+(моей\s+|нашей\s+)?команде|чем\s+занимается\s+(моя\s+|наша\s+)?команда)`)
	reGreeting      = regexp.MustCompile(`^(привет|здравствуй|добрый\s+(день|вечер)|доброе\s+утро|хай|hello|hi)\S*[\s!.,)]*$`)
	reThanks        = regexp.MustCompile(`^(спасибо|благодарю|понял|понятно|ок|окей|хорошо|ясно)\S*[\s!.,)]*`)
	reHelp          = regexp.MustCompile(`(что\s+ты\s+умеешь|чем\s+(ты\s+)?можешь\s+помочь|кто\s+ты|помощь$|^help$)`)
)

func (t *turn) decide() Response {
	u := t.req.User
	switch {
	case t.user == "":
		return say(t.capabilities())
	case u.Escalate != "":
		return t.escalate()
	case reApprovalsList.MatchString(t.low) && u.Role == "lead":
		return t.approvals()
	case reRejectCmd.MatchString(t.low):
		return t.decision("reject_request")
	case reApproveCmd.MatchString(t.low):
		return t.decision("approve_request")
	}
	if m := reOtherPerson.FindStringSubmatch(t.user); m != nil && !strings.HasPrefix(norm(u.Name), norm(m[1])[:len(norm(m[1]))-2]) {
		return t.otherPlan(m[1])
	}
	followUp := strings.Contains(t.prev, AskDateMarker)
	switch {
	case reLeave.MatchString(t.low) && reStatusAsk.MatchString(t.low):
		return t.leaveStatus()
	case reLeave.MatchString(t.low):
		return t.leave(false)
	case followUp && !reAccess.MatchString(t.low) && !reNextSteps.MatchString(t.low):
		if _, _, ok := dates.Parse(t.user, u.Today); ok {
			return t.leave(true)
		}
	}
	switch {
	case reStatusAsk.MatchString(t.low) && strings.Contains(t.low, "заявк"):
		return t.leaveStatus()
	case reAccess.MatchString(t.low):
		return t.access()
	case reTaskDone.MatchString(t.low) || reMarkDone.MatchString(t.low):
		return t.taskDone()
	case reNextSteps.MatchString(t.low):
		return t.nextSteps()
	case reTeam.MatchString(t.low):
		return t.team()
	case reGreeting.MatchString(t.low):
		return say("Привет, " + firstName(u.Name) + "! " + t.capabilities())
	case reHelp.MatchString(t.low):
		return say(t.capabilities())
	case reThanks.MatchString(t.low) && len([]rune(t.low)) < 30:
		return say("Пожалуйста! Если появятся вопросы по адаптации — пиши.")
	}
	return t.knowledge()
}

func (t *turn) capabilities() string {
	if t.req.User.Role == "lead" {
		return "Я AI-buddy. Могу показать заявки команды на согласование, ответить по тестовым инструкциям команды и оформить твои заявки. Спроси, например: «Что мне согласовать?»"
	}
	return "Я AI-buddy, помогаю освоиться в команде. Могу подсказать следующие шаги адаптации, ответить по тестовым инструкциям команды, оформить отгул и запросить доступы. Спроси, например: «Что мне делать дальше?»"
}

func firstName(full string) string {
	if f := strings.Fields(full); len(f) > 0 {
		return f[0]
	}
	return "коллега"
}

// contact выбирает, к кому направить: наставник, а если его нет — руководитель.
func (t *turn) contact(preferLead bool) (name, role string) {
	u := t.req.User
	if (preferLead || u.BuddyName == "") && u.LeadName != "" {
		return u.LeadName, "руководитель"
	}
	if u.BuddyName != "" {
		return u.BuddyName, "наставник"
	}
	return "", ""
}

func draft(to, question string) string {
	return fmt.Sprintf("\n\nЧерновик сообщения:\n> Привет, %s! Подскажи, пожалуйста: %s", firstName(to), strings.TrimSpace(question))
}

func (t *turn) escalate() Response {
	topic := map[string]string{
		"evaluation": "Оценку работы и итоги стажировки лучше обсудить лично — здесь я не подскажу по существу.",
		"conflict":   "Сочувствую, это неприятная ситуация. Такие вопросы лучше решать с человеком, а не со мной.",
		"health":     "Береги себя. Вопросы здоровья и самочувствия я по существу не обсуждаю — тут нужен человек.",
		"money":      "Вопросы оплаты и денег я не обсуждаю — по ним нужен человек.",
	}[t.req.User.Escalate]
	name, role := t.contact(true)
	if name == "" {
		return say(topic + " Обратись к своему руководителю или HR-партнёру.")
	}
	ask := map[string]string{
		"evaluation": "можем коротко обсудить, как оценивается моя работа и что мне стоит улучшить?",
		"conflict":   "у меня возникла сложная ситуация в команде, можно обсудить её лично?",
		"health":     "я неважно себя чувствую и хочу обсудить, как лучше поступить с работой.",
		"money":      "к кому мне обратиться по вопросу оплаты?",
	}[t.req.User.Escalate]
	return say(fmt.Sprintf("%s Лучше поговорить с человеком: %s — твой %s; при необходимости подключится HR-партнёр.\n\nЧерновик сообщения:\n> Привет, %s! %s",
		topic, name, role, firstName(name), strings.ToUpper(string([]rune(ask)[:1]))+string([]rune(ask)[1:])))
}

// --- Сценарий 1: отгул ---

func (t *turn) leave(followUp bool) Response {
	u := t.req.User
	if body, ok := t.result("create_leave_request"); ok {
		if _, bad := isErr(body); bad {
			return errorReply(body)
		}
		who := ""
		if u.LeadName != "" {
			who = " (" + u.LeadName + ")"
		}
		return say("Подготовил заявку — проверь карточку. После подтверждения она уйдёт на согласование руководителю" + who + ".")
	}
	intro := ""
	if !followUp {
		body, ok := t.result("search_knowledge")
		if !ok {
			return Response{ToolCalls: []ToolCall{t.call("search_knowledge", map[string]any{"query": "отгул"})}}
		}
		if _, bad := isErr(body); !bad {
			if items := jsonx.Items(jsonx.Parse([]byte(body))); len(items) > 0 {
				art, ok := t.result("get_knowledge_article")
				if !ok {
					return Response{ToolCalls: []ToolCall{t.call("get_knowledge_article", map[string]any{"id": jsonx.Str(items[0], "id")})}}
				}
				if _, bad := isErr(art); !bad {
					a := jsonx.Object(jsonx.Parse([]byte(art)))
					intro = fmt.Sprintf("По тестовой инструкции «%s»: %s\n\n", jsonx.Str(a, "title"), summarize(jsonx.Str(a, "body"), 420))
				}
			}
		}
		if intro == "" {
			intro = "В базе знаний нет инструкции про отгул, но заявку оформить могу.\n\n"
		}
	}
	from, to, ok := dates.Parse(t.user, u.Today)
	if !ok {
		return say(intro + AskDateMarker + " оформить отгул? Можно написать «в пятницу» или «с 16 по 17 ноября».")
	}
	today := time.Date(u.Today.Year(), u.Today.Month(), u.Today.Day(), 0, 0, 0, 0, time.UTC)
	if from.Before(today) {
		return say(intro + "Дата " + dates.FormatRu(from) + " уже прошла. " + AskDateMarker + " в будущем оформить отгул?")
	}
	reason := "day_off"
	if strings.Contains(t.low, "отпуск") {
		reason = "vacation"
	}
	return Response{
		Content: intro + "Оформляю на " + dates.RangeRu(from.Format(dates.ISO), to.Format(dates.ISO)) + ". ",
		ToolCalls: []ToolCall{t.call("create_leave_request", map[string]any{
			"date_from": from.Format(dates.ISO), "date_to": to.Format(dates.ISO), "reason_type": reason})},
	}
}

var statusRu = map[string]string{
	"pending": "на согласовании", "approved": "одобрена ✅", "rejected": "отклонена", "failed": "не создана из-за сбоя сервиса", "draft": "черновик",
}

func (t *turn) leaveStatus() Response {
	body, ok := t.result("list_my_requests")
	if !ok {
		args := map[string]any{}
		if reLeave.MatchString(t.low) {
			args["type"] = "leave"
		}
		return Response{ToolCalls: []ToolCall{t.call("list_my_requests", args)}}
	}
	if _, bad := isErr(body); bad {
		return errorReply(body)
	}
	items := jsonx.Items(jsonx.Parse([]byte(body)))
	if len(items) == 0 {
		return say("У тебя пока нет таких заявок. Хочешь оформить отгул? Напиши, на какую дату.")
	}
	var b strings.Builder
	start := 0
	if len(items) > 3 {
		start = len(items) - 3
	}
	for _, it := range items[start:] {
		st := jsonx.Str(it, "status")
		line := "- " + requestTitle(it) + " — " + orDefault(statusRu[st], st)
		if st == "pending" && t.req.User.LeadName != "" {
			line += " у руководителя (" + t.req.User.LeadName + ")"
		}
		if c := jsonx.Str(it, "decision_comment"); c != "" {
			line += ". Комментарий: " + c
		}
		b.WriteString(line + "\n")
	}
	return say("Вот статус твоих заявок:\n" + b.String())
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// requestTitle описывает заявку: «Отгул 13 ноября (пятница)», «Доступ: grafana».
func requestTitle(it jsonx.Obj) string {
	p := jsonx.Get(it, "payload")
	if len(p) == 0 {
		p = it
	}
	switch jsonx.Str(it, "type") {
	case "leave":
		kind := "Отгул"
		if jsonx.Str(p, "reason_type") == "vacation" {
			kind = "Отпуск"
		}
		return kind + " " + dates.RangeRu(jsonx.Str(p, "date_from"), jsonx.Str(p, "date_to"))
	case "access":
		return "Доступ: " + jsonx.Str(p, "system")
	}
	return "Заявка №" + jsonx.Str(it, "id")
}

// --- Сценарий 4: доступы ---

func (t *turn) access() Response {
	if body, ok := t.result("create_access_request"); ok {
		if _, bad := isErr(body); bad {
			return errorReply(body)
		}
		who := ""
		if t.req.User.LeadName != "" {
			who = " — " + t.req.User.LeadName
		}
		return say("Отметь в карточке нужные системы и подтверди: по каждой создам запрос, согласует руководитель" + who + ".")
	}
	body, ok := t.result("get_access_overview")
	if !ok {
		return Response{ToolCalls: []ToolCall{t.call("get_access_overview", nil)}}
	}
	if _, bad := isErr(body); bad {
		return errorReply(body)
	}
	systems := jsonx.Items(jsonx.Parse([]byte(body)), "systems")
	if len(systems) == 0 {
		return say("Для твоей команды не нашёл списка систем. Уточни у наставника, какие доступы нужны.")
	}
	groups := map[string][]string{}
	var missing []string
	for _, s := range systems {
		st := jsonx.Str(s, "status")
		line := "- **" + orDefault(jsonx.Str(s, "title"), jsonx.Str(s, "system")) + "** — " + jsonx.Str(s, "purpose")
		if !jsonx.Bool(s, "required") {
			line += " (необязательный)"
		}
		groups[st] = append(groups[st], line)
		if st == "missing" {
			missing = append(missing, jsonx.Str(s, "system"))
		}
	}
	var b strings.Builder
	section := func(title, key string) {
		if len(groups[key]) > 0 {
			b.WriteString(title + "\n" + strings.Join(groups[key], "\n") + "\n\n")
		}
	}
	b.WriteString("Вот доступы твоей команды" + teamSuffix(t.req.User.Team) + ":\n\n")
	section("✅ Уже есть:", "granted")
	section("⏳ Запрошено, ждёт согласования:", "requested")
	section("❗ Не хватает:", "missing")
	if len(missing) == 0 {
		b.WriteString("Все нужные доступы уже выданы или запрошены — новых запросов не требуется.")
		return say(b.String())
	}
	if !t.has("create_access_request") {
		return say(b.String())
	}
	reason := "Нужны для работы в команде"
	if t.req.User.Team != "" {
		reason += " «" + t.req.User.Team + "»"
	}
	return Response{Content: b.String(), ToolCalls: []ToolCall{t.call("create_access_request",
		map[string]any{"systems": missing, "reason": reason + " (адаптация стажёра)"})}}
}

func teamSuffix(team string) string {
	if team == "" {
		return ""
	}
	return " «" + team + "»"
}

// --- Сценарий 2: адаптация ---

func (t *turn) nextSteps() Response {
	prog, ok1 := t.result("get_onboarding_progress")
	steps, ok2 := t.result("get_next_steps")
	if !ok1 || !ok2 {
		return Response{ToolCalls: []ToolCall{t.call("get_onboarding_progress", nil), t.call("get_next_steps", nil)}}
	}
	if _, bad := isErr(steps); bad {
		return errorReply(steps)
	}
	var b strings.Builder
	if _, bad := isErr(prog); !bad {
		p := jsonx.Object(jsonx.Parse([]byte(prog)))
		stage := jsonx.Str(jsonx.Get(p, "current_stage"), "title")
		if stage == "" {
			stage = jsonx.Str(p, "current_stage")
		}
		if stage != "" {
			fmt.Fprintf(&b, "Ты на этапе «%s», общий прогресс адаптации — %d%%.\n\n", stage, jsonx.Int(p, "percent", "total_percent"))
		}
	}
	items := jsonx.Items(jsonx.Parse([]byte(steps)))
	if len(items) == 0 {
		b.WriteString("Обязательные задачи текущего этапа закрыты — отличная работа! 🎉")
		return say(b.String())
	}
	b.WriteString("Следующие шаги:\n")
	accessHint := false
	for i, it := range items {
		fmt.Fprintf(&b, "%d. %s", i+1, jsonx.Str(it, "title"))
		if link := jsonx.Str(it, "link"); link != "" {
			b.WriteString(" — " + link)
		}
		b.WriteString("\n")
		accessHint = accessHint || isAccessTask(it)
	}
	if accessHint {
		b.WriteString("\nЗадача про доступы закроется сама, когда будут выданы все обязательные доступы. Спроси «Какие доступы мне нужны?» — помогу их запросить.")
	} else {
		b.WriteString("\nКогда сделаешь что-то из списка — напиши, например, «я прочитала документацию», и я отмечу задачу.")
	}
	return say(b.String())
}

func isAccessTask(it jsonx.Obj) bool {
	return jsonx.Str(it, "code") == "get_access" || strings.Contains(norm(jsonx.Str(it, "title")), "получить доступ")
}

func (t *turn) taskDone() Response {
	if body, ok := t.result("update_task_status"); ok {
		if _, bad := isErr(body); bad {
			return errorReply(body)
		}
		return say("Подтверди в карточке — и я отмечу задачу выполненной.")
	}
	if !t.has("update_task_status") {
		return say("Отмечать задачи адаптации может только сам стажёр — у тебя такого действия нет.")
	}
	body, ok := t.result("get_onboarding_plan")
	if !ok {
		return Response{ToolCalls: []ToolCall{t.call("get_onboarding_plan", nil)}}
	}
	if _, bad := isErr(body); bad {
		return errorReply(body)
	}
	want := keywords(t.low)
	var best jsonx.Obj
	bestScore := 0
	var open []string
	for _, st := range jsonx.Items(jsonx.Parse([]byte(body)), "stages") {
		tasks, _ := st["tasks"].([]any)
		for _, raw := range tasks {
			task := jsonx.Object(raw)
			if jsonx.Str(task, "status") == "done" {
				continue
			}
			if len(open) < 5 {
				open = append(open, "- "+jsonx.Str(task, "title"))
			}
			have := map[string]bool{}
			for _, k := range keywords(norm(jsonx.Str(task, "title"))) {
				have[k] = true
			}
			score := 0
			for _, k := range want {
				if have[k] {
					score++
				}
			}
			if score > bestScore {
				best, bestScore = task, score
			}
		}
	}
	if best == nil {
		return say("Не нашёл такую задачу среди открытых. Вот что сейчас не закрыто:\n" + strings.Join(open, "\n") + "\n\nКакую отметить выполненной?")
	}
	title := jsonx.Str(best, "title")
	if isAccessTask(best) {
		return say("Задачу «" + title + "» вручную закрыть нельзя: она закроется автоматически, когда будут выданы все обязательные доступы. Спроси «Какие доступы мне нужны?» — помогу запросить недостающие.")
	}
	return Response{Content: "Отлично! Нашёл в плане задачу «" + title + "». ",
		ToolCalls: []ToolCall{t.call("update_task_status", map[string]any{"task_id": jsonx.Str(best, "id"), "status": "done"})}}
}

// --- Руководитель ---

func (t *turn) approvals() Response {
	if _, ok := t.result("approve_request"); ok {
		return say("Подтверди карточки, чтобы одобрить заявки. Чтобы отклонить — отмени карточку и напиши, например, «отклони заявку 101, причина…».")
	}
	if !t.has("list_pending_approvals") {
		return say("Согласовывать заявки может только руководитель команды.")
	}
	body, ok := t.result("list_pending_approvals")
	if !ok {
		return Response{ToolCalls: []ToolCall{t.call("list_pending_approvals", nil)}}
	}
	if _, bad := isErr(body); bad {
		return errorReply(body)
	}
	items := jsonx.Items(jsonx.Parse([]byte(body)))
	if len(items) == 0 {
		return say("Сейчас нет заявок, которые ждут твоего решения.")
	}
	var b strings.Builder
	fmt.Fprintf(&b, "На согласовании заявок: %d.\n", len(items))
	var calls []ToolCall
	for i, it := range items {
		who := jsonx.Str(jsonx.Get(it, "user"), "full_name")
		fmt.Fprintf(&b, "- №%s: %s — %s\n", jsonx.Str(it, "id"), requestTitle(it), orDefault(who, "сотрудник команды"))
		if i < 6 {
			calls = append(calls, t.call("approve_request", map[string]any{"request_id": jsonx.Str(it, "id")}))
		}
	}
	b.WriteString("\n")
	return Response{Content: b.String(), ToolCalls: calls}
}

func (t *turn) decision(tool string) Response {
	if body, ok := t.result(tool); ok {
		if _, bad := isErr(body); bad {
			return errorReply(body)
		}
		return say("Подготовил карточку — подтверди решение.")
	}
	if !t.has(tool) {
		name, _ := t.contact(true)
		who := "руководитель команды"
		if name != "" {
			who += " (" + name + ")"
		}
		return say("Не могу: одобрять и отклонять заявки может только руководитель команды, у тебя таких прав нет. Твои заявки согласует " + who + " — могу проверить их статус.")
	}
	id := reNumber.FindString(t.low)
	if id == "" {
		return t.approvals()
	}
	args := map[string]any{"request_id": id}
	if tool == "reject_request" {
		comment := "Отклонено руководителем"
		if i := strings.Index(t.low, id); i >= 0 {
			if rest := strings.Trim(t.user[strings.Index(t.user, id)+len(id):], " ,.:;—-"); rest != "" {
				comment = rest
			}
		}
		args["comment"] = comment
	}
	return Response{ToolCalls: []ToolCall{t.call(tool, args)}}
}

func (t *turn) otherPlan(name string) Response {
	const refuse = "Не могу показать: данные и план адаптации других сотрудников тебе недоступны — я работаю только с твоими правами. Могу показать твой собственный план: спроси «Что мне делать дальше?»"
	if plan, ok := t.result("get_onboarding_plan"); ok {
		if _, bad := isErr(plan); bad {
			return say(refuse)
		}
		total, done := 0, 0
		var open []string
		for _, st := range jsonx.Items(jsonx.Parse([]byte(plan)), "stages") {
			tasks, _ := st["tasks"].([]any)
			for _, raw := range tasks {
				task := jsonx.Object(raw)
				total++
				if jsonx.Str(task, "status") == "done" {
					done++
				} else if len(open) < 3 {
					open = append(open, "- "+jsonx.Str(task, "title"))
				}
			}
		}
		return say(fmt.Sprintf("План адаптации (%s): выполнено %d из %d задач. Ближайшие открытые:\n%s", name, done, total, strings.Join(open, "\n")))
	}
	people, ok := t.result("find_person")
	if !ok {
		r := []rune(name)
		if len(r) > 4 {
			r = r[:len(r)-1] // «Бориса» → «Борис»
		}
		return Response{ToolCalls: []ToolCall{t.call("find_person", map[string]any{"query": string(r)})}}
	}
	if _, bad := isErr(people); bad {
		return say(refuse)
	}
	items := jsonx.Items(jsonx.Parse([]byte(people)))
	if len(items) == 0 {
		return say(refuse)
	}
	return Response{ToolCalls: []ToolCall{t.call("get_onboarding_plan", map[string]any{"user_id": jsonx.Str(items[0], "id")})}}
}

// --- Сценарий 3: вопросы о команде и базе знаний ---

func (t *turn) team() Response {
	body, ok := t.result("get_team_info")
	if !ok {
		return Response{ToolCalls: []ToolCall{t.call("get_team_info", nil)}}
	}
	if _, bad := isErr(body); bad {
		return errorReply(body)
	}
	tm := jsonx.Object(jsonx.Parse([]byte(body)))
	var b strings.Builder
	fmt.Fprintf(&b, "Команда «%s»: %s\n", jsonx.Str(tm, "name"), jsonx.Str(tm, "description"))
	list := func(title, key string) {
		arr, _ := tm[key].([]any)
		var parts []string
		for _, v := range arr {
			switch x := v.(type) {
			case string:
				parts = append(parts, x)
			case map[string]any:
				parts = append(parts, orDefault(jsonx.Str(x, "title", "name"), jsonx.Str(x, "system")))
			}
		}
		if len(parts) > 0 {
			b.WriteString("- " + title + ": " + strings.Join(parts, ", ") + "\n")
		}
	}
	list("Инструменты", "tools")
	list("Каналы", "channels")
	list("Правила", "rules")
	if s := jsonx.Str(tm, "standup"); s != "" {
		b.WriteString("- Стендап: " + s + "\n")
	}
	if s := jsonx.Str(tm, "docs_url"); s != "" {
		b.WriteString("- Документация: " + s + "\n")
	}
	b.WriteString("\nЭто тестовые данные команды.")
	return say(b.String())
}

func (t *turn) knowledge() Response {
	if art, ok := t.result("get_knowledge_article"); ok {
		if _, bad := isErr(art); bad {
			return errorReply(art)
		}
		a := jsonx.Object(jsonx.Parse([]byte(art)))
		return say(fmt.Sprintf("По тестовой инструкции «%s»: %s", jsonx.Str(a, "title"), summarize(jsonx.Str(a, "body"), 600)))
	}
	body, ok := t.result("search_knowledge")
	if !ok {
		kw := keywords(t.low)
		if len(kw) == 0 {
			return say(t.capabilities())
		}
		return Response{ToolCalls: []ToolCall{t.call("search_knowledge", map[string]any{"query": strings.Join(queryWords(t.low), " ")})}}
	}
	if _, bad := isErr(body); bad {
		return errorReply(body)
	}
	items := jsonx.Items(jsonx.Parse([]byte(body)))
	if len(items) == 0 {
		name, role := t.contact(false)
		if name == "" {
			return say("В базе знаний этого нет, а выдумывать правила я не буду. Лучше уточнить у наставника или руководителя.")
		}
		return say(fmt.Sprintf("В базе знаний этого нет, а выдумывать правила я не буду. Лучше спросить у человека: %s — твой %s.", name, role) + draft(name, t.user))
	}
	return Response{ToolCalls: []ToolCall{t.call("get_knowledge_article", map[string]any{"id": jsonx.Str(items[0], "id")})}}
}

// summarize убирает пометку «Тестовая инструкция.» и обрезает текст по границе предложения.
func summarize(body string, max int) string {
	body = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(body), "Тестовая инструкция."))
	r := []rune(body)
	if len(r) <= max {
		return body
	}
	cut := string(r[:max])
	if i := strings.LastIndexAny(cut, ".!?"); i > max/3 {
		return cut[:i+1]
	}
	return cut + "…"
}

var stop = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`как у нас нам наш наша наше наши нашего нашей проходит проходят где что такое зачем она он оно они мне меня мой моя мои когда кто и а в во на по за к ко с со для это эта этот ли же бы не ни да нет или то такой какой какая какие каким образом нужно надо можно ли есть быть будет я ты мы вы его ее их там тут здесь вообще подскажи скажи расскажи пожалуйста привет объясни про о об от до из уже еще ещё очень тоже так вот чем при над под лежит находится устроен устроено устроена работает делается делать сделать нужна нужен нужны обычно сейчас сегодня хочу хотел хотела могу можешь узнать найти посмотреть`) {
		stop[w] = true
	}
}

func words(low string) []string {
	return strings.FieldsFunc(low, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '-'
	})
}

// queryWords — значимые слова вопроса для поискового запроса.
func queryWords(low string) []string {
	var out []string
	for _, w := range words(low) {
		w = strings.Trim(w, "-")
		if len([]rune(w)) < 2 || stop[w] {
			continue
		}
		out = append(out, w)
		if len(out) == 6 {
			break
		}
	}
	return out
}

// keywords — основы значимых слов (первые 5 букв) для нечёткого сравнения.
func keywords(low string) []string {
	var out []string
	for _, w := range queryWords(strings.ReplaceAll(low, "-", " ")) {
		r := []rune(w)
		if len(r) > 5 {
			r = r[:5]
		}
		out = append(out, string(r))
	}
	return out
}
