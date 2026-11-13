# API агента AI-buddy (для фронтенда)

Сервис `agent`, порт **8081**, префикс `/api/v1/agent`. Все данные синтетические, инструкции — тестовые.

## Общие правила

- **Авторизация:** каждый запрос — с заголовком `Authorization: Bearer <JWT>`, тот же токен, что выдаёт `POST /api/v1/auth/login` основного API (:8080). Агент пробрасывает его в MCP и дальше в API, своих прав у агента нет.
- **Ошибки (не-SSE):** как в основном API — `{"error":{"code":"…","message":"…","retryable":false}}`.

| HTTP | code | Когда |
|---|---|---|
| 400 | `validation_error` | пустое сообщение, длиннее 2000 символов, битый JSON |
| 401 | `unauthorized` | нет или просрочен токен |
| 404 | `action_not_found` | карточки нет или она чужая |
| 410 | `action_expired` | карточке больше 30 минут или она отменена |
| 429 | `rate_limited` | больше 20 сообщений в минуту от пользователя |

- **CORS** открыт (`CORS_ORIGINS`, по умолчанию `*`).

## POST /api/v1/agent/chat

Запрос:

```json
{ "message": "Хочу отгул в пятницу", "conversation_id": "необязательно" }
```

`conversation_id` — идентификатор диалога. Если не передан, агент создаёт новый и возвращает его в `done`; передавайте его в следующих сообщениях, чтобы агент помнил контекст.

Ответ — поток **SSE** (`Content-Type: text/event-stream`). Запрос — POST, поэтому `EventSource` не подходит: читайте через `fetch` + `ReadableStream` (или `@microsoft/fetch-event-source`). Формат кадра:

```
event: <тип>
data: <JSON>

```

| Событие | data | Когда |
|---|---|---|
| `status` | `{"text":"Ищу в базе знаний…"}` | агент думает или вызывает инструмент; показывать индикатором, каждое новое заменяет предыдущее |
| `token` | `{"text":"кусок "}` | кусок ответа, склеивать по порядку (текст — Markdown) |
| `sources` | `[{"id":"9","title":"Код-ревью в команде Доставка"}]` | ответ опирается на статьи базы знаний |
| `action_proposal` | см. ниже | агент предлагает действие — показать карточку |
| `action_result` | см. confirm | только в SSE-варианте confirm |
| `error` | `{"code":"llm_unavailable","message":"…","retryable":true}` | сбой; при `retryable=true` показать «Повторить» |
| `done` | `{"conversation_id":"…"}` | всегда последнее событие, в том числе после `error` |

Первое событие (`status`) приходит сразу, быстрее 1 с. Событий `action_proposal` в одном ответе может быть несколько (руководителю — по карточке на заявку). Обрыв соединения клиентом (`AbortController`) останавливает генерацию.

Коды `error`: `llm_unavailable`, `tool_failed`, `timeout`, `internal_error`, `unauthorized`.

Пример потока:

```
event: status
data: {"text":"Ищу в базе знаний…"}

event: token
data: {"text":"По тестовой инструкции "}

event: sources
data: [{"id":"1","title":"Как оформить отгул"}]

event: action_proposal
data: {"action_id":"act_3f2a…","type":"leave_request","title":"Заявка на отгул","summary":"Отгул 13 ноября (пятница), 1 день","params":{"date_from":"2026-11-13","date_to":"2026-11-13","reason_type":"day_off","comment":""},"expires_at":"2026-11-11T12:30:00Z"}

event: done
data: {"conversation_id":"c_81b0…"}
```

### action_proposal

```json
{
  "action_id": "act_…",
  "type": "leave_request",
  "title": "Заявка на отгул",
  "summary": "Отгул 13 ноября (пятница), 1 день",
  "params": { },
  "options": { },
  "expires_at": "2026-11-11T12:30:00Z"
}
```

| type | params (редактируемые) | options (только для отображения) |
|---|---|---|
| `leave_request` | `date_from`, `date_to` (YYYY-MM-DD), `reason_type` (`day_off`\|`vacation`\|`sick_note_placeholder`), `comment` | — |
| `access_request` | `systems`: `["grafana","vpn"]`, `reason` | `systems`: `[{"system":"grafana","title":"Grafana","purpose":"…","required":true}]` — подписи для чекбоксов |
| `task_status` | `task_id`, `status` (`todo`\|`in_progress`\|`done`\|`blocked`), `comment` | `task_title` |
| `approve` | `request_id`, `comment` | `request`: объект заявки (кто, что, даты) |
| `reject` | `request_id`, `comment` (обязателен) | `request` |

В `params` карточек `approve` и `reject` дополнительно приходят поля только для отображения: `request_number` (короткий номер), `request_type` (`leave`\|`access`), `author_name`, `summary` (даты отгула или система). При confirm их передавать не нужно — учитывается только `comment`.

Для доступов приходит **одна** карточка со списком систем: фронт показывает чекбоксы и передаёт выбранные в `params.systems` при confirm. Для заявок руководителя приходит карточка `approve`; чтобы отклонить — отменить её и написать «отклони заявку …» либо показать кнопку, отправляющую такое сообщение.

Пока пользователь не подтвердил карточку, ничего не меняется. Карточка живёт 30 минут.

## POST /api/v1/agent/actions/{action_id}/confirm

Запрос (тело необязательно): `{ "params": { "comment": "по семейным обстоятельствам" } }` — переданные поля заменяют предложенные, остальные остаются.

Ответ `200` (JSON, тот же объект приходит в `action_result`):

```json
{
  "action_id": "act_…",
  "type": "leave_request",
  "status": "done",
  "message": "Готово: заявка на отгул 13 ноября создана и ушла на согласование — Елена Морозова.",
  "data": { "id": 101, "type": "leave", "status": "pending", "payload": { } },
  "error": null,
  "conversation_id": "c_…"
}
```

- `status`: `done` — выполнено; `partial` — выполнена часть (например, 2 из 3 доступов); `failed` — не выполнено.
- `message` — готовый текст для показа в чате.
- `data` — ответ основного API: объект заявки/задачи; для `access_request` — `{"results":[{"system":"grafana","ok":true,"request":{…}},{"system":"vpn","ok":false,"error":"…"}]}`.
- `error` при `failed`/`partial`: `{"code":"upstream_unavailable","message":"…","retryable":true}`. При `retryable=true` карточка остаётся активной — confirm можно повторить.
- Повторный confirm выполненной карточки возвращает тот же результат, дубль не создаётся (Idempotency-Key = `action_id`).

С заголовком `Accept: text/event-stream` тот же результат приходит потоком: `status` → `action_result` → `token` (текст `message`) → `done`.

## POST /api/v1/agent/actions/{action_id}/cancel

Ответ `200`: `{"action_id":"act_…","status":"cancelled"}`. После отмены confirm вернёт `410`.

## GET /api/v1/agent/suggestions

Подсказки-кнопки для старта диалога с учётом роли и этапа адаптации:

```json
{ "suggestions": [ {"text":"Что мне делать дальше?"}, {"text":"Какие доступы мне нужны?"}, {"text":"Как оформить отгул?"}, {"text":"Как у нас проходит код-ревью?"} ] }
```

Нажатие отправляет `text` в `/chat`.

## GET /healthz

`200 {"status":"ok","service":"agent","llm":"mock"}` — поле `llm` показывает активного провайдера (`mock` или `openai`).

## Быстрая проверка

```bash
TOKEN=$(curl -s localhost:8080/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"login":"intern_anna","password":"test1234"}' | jq -r .access_token)
curl -N localhost:8081/api/v1/agent/chat -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"message":"Хочу отгул в пятницу"}'
```
