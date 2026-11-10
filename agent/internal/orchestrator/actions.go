package orchestrator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"ai-buddy/agent/internal/dates"
	"ai-buddy/agent/internal/jsonx"
	"ai-buddy/agent/internal/mcpclient"
	"ai-buddy/agent/internal/store"
)

// Типы карточек действий.
const (
	TypeLeave   = "leave_request"
	TypeAccess  = "access_request"
	TypeTask    = "task_status"
	TypeApprove = "approve"
	TypeReject  = "reject"
)

// Ошибки подтверждения.
var (
	ErrActionNotFound = errors.New("action not found")
	ErrActionExpired  = errors.New("action expired")
	ErrActionBusy     = errors.New("action is being executed")
)

// ActionResult — результат подтверждённого действия (ответ confirm и событие action_result).
type ActionResult struct {
	ActionID       string     `json:"action_id"`
	Type           string     `json:"type"`
	Status         string     `json:"status"` // done | partial | failed
	Message        string     `json:"message"`
	Data           any        `json:"data"`
	Error          *ErrorBody `json:"error"`
	ConversationID string     `json:"conversation_id"`
}

const maxProposals = 8

func toolError(code, msg string) string { return "ERROR code=" + code + ": " + msg }

func argStr(args map[string]any, key string) string {
	switch v := args[key].(type) {
	case string:
		return strings.TrimSpace(v)
	case float64, json.Number:
		return jsonx.Str(map[string]any{key: v}, key)
	}
	return ""
}

func plural(n int, one, few, many string) string {
	switch {
	case n%10 == 1 && n%100 != 11:
		return fmt.Sprintf("%d %s", n, one)
	case n%10 >= 2 && n%10 <= 4 && (n%100 < 12 || n%100 > 14):
		return fmt.Sprintf("%d %s", n, few)
	}
	return fmt.Sprintf("%d %s", n, many)
}

var taskStatusRu = map[string]string{"todo": "к выполнению", "in_progress": "в работе", "done": "выполнена", "blocked": "заблокирована"}

// propose превращает вызов изменяющего инструмента в карточку: ничего не выполняет,
// сохраняет pending-действие и отправляет action_proposal. Возвращает текст для модели.
func (o *Orchestrator) propose(ctx context.Context, t *turn, tool string, args map[string]any) string {
	if len(t.proposals) >= maxProposals {
		return toolError("limit", "слишком много карточек в одном ответе")
	}
	a := &store.Action{ID: newID("act_"), UserID: t.id.ID, ConversationID: t.conv, Tool: tool,
		Status: store.StatusPending, ExpiresAt: o.Now().Add(o.Cfg.PendingTTL).UTC()}
	var errText string
	switch tool {
	case "create_leave_request":
		errText = o.proposeLeave(a, args)
	case "create_access_request":
		errText = o.proposeAccess(ctx, t, a, args)
	case "update_task_status":
		errText = o.proposeTask(ctx, t, a, args)
	case "approve_request", "reject_request":
		errText = o.proposeDecision(ctx, t, a, args)
	default:
		// Неизвестный изменяющий инструмент не исполняем никогда.
		errText = toolError("forbidden", "это действие не поддерживается")
	}
	if errText != "" {
		return errText
	}
	if err := o.Store.SaveAction(ctx, a, o.Cfg.PendingTTL); err != nil {
		o.Log.Error("pending action not saved", "err", err.Error())
		return toolError("internal_error", "не удалось подготовить карточку, попробуй ещё раз")
	}
	t.proposals = append(t.proposals, a.Summary)
	t.em.Emit("action_proposal", map[string]any{"action_id": a.ID, "type": a.Type, "title": a.Title,
		"summary": a.Summary, "params": a.Params, "options": a.Options, "expires_at": a.ExpiresAt.Format(time.RFC3339)})
	o.event(t.token, "action_proposed", map[string]any{"action_id": a.ID, "type": a.Type})
	return "PROPOSED: карточка «" + a.Summary + "» показана пользователю и ждёт его подтверждения. Действие ещё НЕ выполнено — не говори, что оно сделано."
}

func (o *Orchestrator) proposeLeave(a *store.Action, args map[string]any) string {
	from, to, reason := argStr(args, "date_from"), argStr(args, "date_to"), argStr(args, "reason_type")
	if to == "" {
		to = from
	}
	if reason != "vacation" && reason != "sick_note_placeholder" {
		reason = "day_off"
	}
	if msg := validateLeave(from, to, o.Now()); msg != "" {
		return toolError("validation_error", msg)
	}
	kind := "отгул"
	if reason == "vacation" {
		kind = "отпуск"
	}
	a.Type, a.Title = TypeLeave, "Заявка на "+kind
	a.Params = map[string]any{"date_from": from, "date_to": to, "reason_type": reason, "comment": argStr(args, "comment")}
	a.Summary = leaveSummary(a.Params)
	return ""
}

func validateLeave(from, to string, now time.Time) string {
	f, e1 := time.Parse(dates.ISO, from)
	tt, e2 := time.Parse(dates.ISO, to)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	switch {
	case e1 != nil || e2 != nil:
		return "даты нужно указать в формате ГГГГ-ММ-ДД. Уточни дату у пользователя."
	case f.Before(today):
		return "дата начала " + dates.FormatRu(f) + " уже прошла (сегодня " + dates.FormatRu(today) + "). Попроси пользователя назвать будущую дату."
	case tt.Before(f):
		return "дата окончания раньше даты начала. Уточни даты у пользователя."
	case dates.Days(from, to) > 14:
		return "отгул не может быть длиннее 14 дней. Попроси пользователя сократить период."
	}
	return ""
}

func leaveSummary(p map[string]any) string {
	from, to := argStr(p, "date_from"), argStr(p, "date_to")
	kind := "Отгул"
	if argStr(p, "reason_type") == "vacation" {
		kind = "Отпуск"
	}
	return kind + " " + dates.RangeRu(from, to) + ", " + plural(dates.Days(from, to), "день", "дня", "дней")
}

func (o *Orchestrator) proposeAccess(ctx context.Context, t *turn, a *store.Action, args map[string]any) string {
	systems := stringList(args["systems"])
	if len(systems) == 0 {
		return toolError("validation_error", "не указаны системы. Сначала вызови get_access_overview.")
	}
	if t.overview == nil {
		if res := t.sess.Call(ctx, "get_access_overview", nil, ""); !res.IsError {
			t.overview = jsonx.Items(jsonx.Parse([]byte(res.Text)), "systems")
		}
	}
	var chosen []string
	var options []map[string]any
	var titles []string
	seen := map[string]bool{}
	for _, code := range systems {
		code = strings.ToLower(strings.TrimSpace(code))
		if seen[code] {
			continue
		}
		seen[code] = true
		meta := map[string]any{"system": code, "title": code}
		if t.overview != nil {
			var found jsonx.Obj
			for _, s := range t.overview {
				if strings.EqualFold(jsonx.Str(s, "system"), code) {
					found = s
				}
			}
			// Запрашиваем только то, чего действительно не хватает.
			if found == nil || jsonx.Str(found, "status") != "missing" {
				continue
			}
			meta = map[string]any{"system": code, "title": orStr(jsonx.Str(found, "title"), code),
				"purpose": jsonx.Str(found, "purpose"), "required": jsonx.Bool(found, "required")}
		}
		chosen = append(chosen, code)
		options = append(options, meta)
		titles = append(titles, fmt.Sprint(meta["title"]))
	}
	if len(chosen) == 0 {
		return toolError("conflict", "все эти доступы уже выданы или запрошены — карточка не нужна. Так и скажи пользователю.")
	}
	reason := argStr(args, "reason")
	if reason == "" {
		reason = "Нужны для работы в команде (адаптация)"
	}
	a.Type, a.Title = TypeAccess, "Запрос доступов"
	a.Params = map[string]any{"systems": chosen, "reason": reason}
	a.Options = map[string]any{"systems": options}
	a.Summary = "Запросить доступы: " + strings.Join(titles, ", ")
	return ""
}

func orStr(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func (o *Orchestrator) proposeTask(ctx context.Context, t *turn, a *store.Action, args map[string]any) string {
	id, status := argStr(args, "task_id"), argStr(args, "status")
	if _, ok := taskStatusRu[status]; !ok {
		status = "done"
	}
	if id == "" {
		return toolError("validation_error", "не указана задача. Найди её через get_onboarding_plan.")
	}
	if t.tasks == nil {
		if res := t.sess.Call(ctx, "get_onboarding_plan", nil, ""); !res.IsError {
			t.tasks = flattenTasks(res.Text)
		}
	}
	title := "№" + id
	if t.tasks != nil {
		var found jsonx.Obj
		for _, task := range t.tasks {
			if jsonx.Str(task, "id") == id {
				found = task
			}
		}
		if found == nil {
			return toolError("not_found", "такой задачи нет в плане пользователя. Найди задачу через get_onboarding_plan.")
		}
		title = jsonx.Str(found, "title")
		if jsonx.Str(found, "code") == "get_access" && status == "done" {
			return toolError("conflict", "задача «"+title+"» закрывается автоматически, когда выданы все обязательные доступы. Объясни это и предложи запросить доступы.")
		}
	}
	a.Type, a.Title = TypeTask, "Статус задачи"
	a.Params = map[string]any{"task_id": id, "status": status, "comment": argStr(args, "comment")}
	a.Options = map[string]any{"task_title": title}
	a.Summary = taskSummary(title, status)
	return ""
}

func taskSummary(title, status string) string {
	if status == "done" {
		return "Отметить задачу «" + title + "» выполненной"
	}
	return "Задача «" + title + "»: статус «" + taskStatusRu[status] + "»"
}

func (o *Orchestrator) proposeDecision(ctx context.Context, t *turn, a *store.Action, args map[string]any) string {
	id := argStr(args, "request_id")
	if id == "" {
		return toolError("validation_error", "не указана заявка. Возьми id из list_pending_approvals.")
	}
	comment := argStr(args, "comment")
	a.Type, a.Title = TypeApprove, "Одобрить заявку"
	verb := "Одобрить"
	if a.Tool == "reject_request" {
		a.Type, a.Title, verb = TypeReject, "Отклонить заявку", "Отклонить"
		if comment == "" {
			return toolError("validation_error", "для отклонения нужен комментарий. Спроси у пользователя причину.")
		}
	}
	var req jsonx.Obj
	for _, r := range t.approvals {
		if jsonx.Str(r, "id") == id {
			req = r
		}
	}
	if req == nil {
		res := t.sess.Call(ctx, "get_request", map[string]any{"id": id}, "")
		if res.IsError {
			return res.Text
		}
		req = jsonx.Object(jsonx.Parse([]byte(res.Text)))
	}
	a.Params = map[string]any{"request_id": id, "comment": comment}
	a.Options = map[string]any{"request": req}
	a.Summary = verb + ": " + requestTitle(req)
	if who := jsonx.Str(jsonx.Get(req, "user"), "full_name"); who != "" {
		a.Summary += " — " + who
	}
	return ""
}

// requestTitle описывает заявку человеческим языком.
func requestTitle(r jsonx.Obj) string {
	p := jsonx.Get(r, "payload")
	if len(p) == 0 {
		p = r
	}
	switch jsonx.Str(r, "type") {
	case "leave":
		return leaveSummary(p)
	case "access":
		return "Доступ к " + jsonx.Str(p, "system")
	}
	return "Заявка №" + jsonx.Str(r, "id")
}

// editable — какие параметры карточки пользователь может поменять при подтверждении.
var editable = map[string][]string{
	TypeLeave:   {"date_from", "date_to", "reason_type", "comment"},
	TypeAccess:  {"systems", "reason"},
	TypeTask:    {"status", "comment"},
	TypeApprove: {"comment"},
	TypeReject:  {"comment"},
}

func (o *Orchestrator) loadAction(ctx context.Context, id Identity, actionID string) (*store.Action, error) {
	a, err := o.Store.GetAction(ctx, actionID)
	if errors.Is(err, store.ErrNotFound) {
		// Просроченная карточка неотличима от несуществующей: TTL истёк.
		return nil, ErrActionExpired
	}
	if err != nil {
		return nil, err
	}
	if a.UserID != id.ID {
		// Чужую карточку нельзя ни подтвердить, ни увидеть.
		return nil, ErrActionNotFound
	}
	return a, nil
}

// Confirm выполняет подтверждённое пользователем действие через MCP-инструмент.
func (o *Orchestrator) Confirm(ctx context.Context, id Identity, token, actionID string, override map[string]any) (*ActionResult, error) {
	a, err := o.loadAction(ctx, id, actionID)
	if err != nil {
		return nil, err
	}
	switch a.Status {
	case store.StatusCancelled:
		return nil, ErrActionExpired
	case store.StatusDone:
		// Повторный confirm: возвращаем сохранённый результат, ничего не вызывая.
		var cached ActionResult
		if json.Unmarshal(a.Result, &cached) == nil {
			return &cached, nil
		}
	}
	locked, err := o.Store.Lock(ctx, "action:"+a.ID, 30*time.Second)
	if err != nil {
		return nil, err
	}
	if !locked {
		return nil, ErrActionBusy
	}
	defer o.Store.Unlock(context.WithoutCancel(ctx), "action:"+a.ID)

	for _, k := range editable[a.Type] {
		if v, ok := override[k]; ok {
			a.Params[k] = v
		}
	}
	res := &ActionResult{ActionID: a.ID, Type: a.Type, ConversationID: a.ConversationID}
	ctx, cancel := context.WithTimeout(ctx, o.Cfg.RequestTimeout)
	defer cancel()
	sess, err := o.MCP.Connect(ctx, token)
	if err != nil {
		res.Status = "failed"
		res.Error = &ErrorBody{Code: "tool_failed", Retryable: true, Message: "Не удалось подключиться к корпоративным сервисам."}
		res.Message = "Не получилось выполнить действие: сервисы временно недоступны. Карточка активна — попробуй подтвердить ещё раз через минуту."
		return res, nil
	}
	defer sess.Close()

	// Idempotency-Key = action_id: повтор не создаст дубль. После сбоя ключ меняется,
	// чтобы повторная попытка не вернула сохранённую неудачу.
	key := a.ID
	if a.Attempts > 0 {
		key = fmt.Sprintf("%s:r%d", a.ID, a.Attempts)
	}
	switch a.Type {
	case TypeAccess:
		o.execAccess(ctx, sess, a, key, res)
	default:
		o.execSingle(ctx, sess, a, key, res)
	}

	remaining := max(a.ExpiresAt.Sub(o.Now()), time.Minute)
	if res.Status == "failed" {
		a.Attempts++
		o.event(token, "action_failed", map[string]any{"action_id": a.ID, "type": a.Type, "code": res.Error.Code})
	} else {
		a.Status = store.StatusDone
		a.Result, _ = json.Marshal(res)
		o.event(token, "action_confirmed", map[string]any{"action_id": a.ID, "type": a.Type, "status": res.Status})
	}
	if err := o.Store.SaveAction(context.WithoutCancel(ctx), a, remaining); err != nil {
		o.Log.Error("action state not saved", "err", err.Error())
	}
	o.remember(id, token, a.ConversationID, "", res.Message, nil)
	return res, nil
}

func failBody(r mcpclient.Result) *ErrorBody {
	return &ErrorBody{Code: r.Code, Message: r.Message, Retryable: r.Retryable}
}

func failMessage(r mcpclient.Result) string {
	switch r.Code {
	case "validation_error", "conflict", "invalid_arguments":
		return "Не получилось: " + strings.TrimRight(lowerFirst(r.Message), ".") + ". Поправь параметры в карточке и подтверди ещё раз."
	case "forbidden", "not_found":
		return "Не получилось: на это действие у тебя нет прав."
	case "unauthorized":
		return "Сессия истекла — войди заново и повтори."
	}
	return "Не получилось: корпоративный сервис сейчас недоступен. Карточка активна — попробуй подтвердить ещё раз через минуту."
}

func lowerFirst(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	return strings.ToLower(string(r[:1])) + string(r[1:])
}

func (o *Orchestrator) execSingle(ctx context.Context, sess mcpclient.Session, a *store.Action, key string, res *ActionResult) {
	if a.Type == TypeLeave {
		if msg := validateLeave(argStr(a.Params, "date_from"), argStr(a.Params, "date_to"), o.Now()); msg != "" {
			r := mcpclient.Result{Code: "validation_error", Message: strings.SplitN(msg, ". ", 2)[0]}
			res.Status, res.Error, res.Message = "failed", failBody(r), failMessage(r)
			return
		}
	}
	args := map[string]any{}
	for k, v := range a.Params {
		if s, ok := v.(string); ok && s == "" {
			continue // необязательные пустые поля не отправляем
		}
		args[k] = v
	}
	r := sess.Call(ctx, a.Tool, args, key)
	if r.IsError {
		res.Status, res.Error, res.Message = "failed", failBody(r), failMessage(r)
		return
	}
	data := jsonx.Object(jsonx.Parse([]byte(r.Text)))
	res.Status, res.Data = "done", data
	switch a.Type {
	case TypeLeave:
		res.Message = "Готово: заявка создана — " + lowerFirst(leaveSummary(a.Params)) + ". Сейчас она на согласовании" +
			approver(ctx, sess, data) + ". Спроси «Одобрили мой отгул?» — проверю статус."
	case TypeTask:
		title, _ := a.Options["task_title"].(string)
		res.Message = "Готово: задача «" + title + "» — статус «" + taskStatusRu[argStr(a.Params, "status")] + "»."
		if argStr(a.Params, "status") == "done" {
			res.Message = "Готово: задача «" + title + "» отмечена выполненной ✅. Спроси «Что дальше?» — подскажу следующий шаг."
		}
	case TypeApprove:
		res.Message = "Готово: заявка одобрена ✅. Сотрудник увидит новый статус."
	case TypeReject:
		res.Message = "Готово: заявка отклонена. Сотрудник увидит статус и твой комментарий."
	}
}

// approver возвращает « у руководителя (Имя)» по ответу API или профилю.
func approver(ctx context.Context, sess mcpclient.Session, data jsonx.Obj) string {
	name := jsonx.Str(jsonx.Get(data, "approver"), "full_name")
	if name == "" {
		if r := sess.Call(ctx, "get_my_profile", nil, ""); !r.IsError {
			name = jsonx.Str(jsonx.Get(jsonx.Object(jsonx.Parse([]byte(r.Text))), "lead"), "full_name")
		}
	}
	if name == "" {
		return " у руководителя"
	}
	return " у руководителя (" + name + ")"
}

func (o *Orchestrator) execAccess(ctx context.Context, sess mcpclient.Session, a *store.Action, key string, res *ActionResult) {
	allowed := map[string]string{}
	if opts, ok := a.Options["systems"].([]any); ok {
		for _, raw := range opts {
			m := jsonx.Object(raw)
			allowed[jsonx.Str(m, "system")] = jsonx.Str(m, "title")
		}
	}
	var systems []string
	for _, s := range stringList(a.Params["systems"]) {
		if _, ok := allowed[s]; ok || len(allowed) == 0 {
			systems = append(systems, s)
		}
	}
	if len(systems) == 0 {
		r := mcpclient.Result{Code: "validation_error", Message: "Не выбрано ни одной системы"}
		res.Status, res.Error, res.Message = "failed", failBody(r), failMessage(r)
		return
	}
	reason := argStr(a.Params, "reason")
	var okNames, failNames []string
	var results []map[string]any
	var lastErr mcpclient.Result
	var first jsonx.Obj
	for _, s := range systems {
		name := orStr(allowed[s], s)
		r := sess.Call(ctx, "create_access_request", map[string]any{"system": s, "reason": reason}, key+":"+s)
		if r.IsError {
			lastErr = r
			failNames = append(failNames, name)
			results = append(results, map[string]any{"system": s, "ok": false, "error": r.Message})
			continue
		}
		data := jsonx.Object(jsonx.Parse([]byte(r.Text)))
		if first == nil {
			first = data
		}
		okNames = append(okNames, name)
		results = append(results, map[string]any{"system": s, "ok": true, "request": data})
	}
	res.Data = map[string]any{"results": results}
	switch {
	case len(okNames) == 0:
		res.Status, res.Error, res.Message = "failed", failBody(lastErr), failMessage(lastErr)
	case len(failNames) > 0:
		res.Status, res.Error = "partial", failBody(lastErr)
		res.Message = "Запросы созданы: " + strings.Join(okNames, ", ") + ". Не получилось: " + strings.Join(failNames, ", ") +
			" (" + strings.TrimRight(lowerFirst(lastErr.Message), ".") + "). Созданные запросы на согласовании" + approver(ctx, sess, first) + "."
	default:
		res.Status = "done"
		res.Message = "Готово: " + plural(len(okNames), "запрос создан", "запроса создано", "запросов создано") + " — " + strings.Join(okNames, ", ") +
			". Они на согласовании" + approver(ctx, sess, first) + ". Когда все обязательные доступы выдадут, задача «Получить доступы» закроется сама."
	}
}

// Cancel отменяет карточку: после этого confirm невозможен.
func (o *Orchestrator) Cancel(ctx context.Context, id Identity, token, actionID string) error {
	a, err := o.loadAction(ctx, id, actionID)
	if err != nil {
		return err
	}
	if a.Status == store.StatusDone {
		return ErrActionExpired
	}
	a.Status = store.StatusCancelled
	o.event(token, "action_cancelled", map[string]any{"action_id": a.ID, "type": a.Type})
	o.remember(id, token, a.ConversationID, "", "[Пользователь отменил карточку: "+a.Summary+"]", nil)
	return o.Store.SaveAction(ctx, a, max(a.ExpiresAt.Sub(o.Now()), time.Minute))
}

