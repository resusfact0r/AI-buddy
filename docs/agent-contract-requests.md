# Бэкенд 2 → Бэкенд 1: на какой контракт опирается агент

Кода и `docs/openapi.yaml` Бэкенда 1 в репозитории на момент написания не было, поэтому MCP-инструменты сделаны по описанию из постановки. Ниже — что именно агент ждёт от API. Пункты с пометкой **Запрос** прошу подтвердить или поправить; всё, что разойдётся, чинится в одном месте — `agent/internal/tools/registry.go` (пути) и `agent/internal/fakeapi` (эталон ответов для тестов).

Разбор ответов терпимый к форме: `id` может быть числом или строкой; список — массивом или объектом с полем `items` / `data` / `results`.

## Эндпоинты, которые вызывает агент

| Инструмент MCP | Запрос к API | Какие поля ответа читает агент |
|---|---|---|
| (авторизация) | `GET /auth/me` | `id`, `role`, `full_name` (на верхнем уровне или в `user`) |
| `get_my_profile` | `GET /me/profile` | `team.id`, `team.name`, `buddy.full_name`, `lead.full_name` |
| `get_team_info` | `GET /teams/{id}` | `name`, `description`, `tools[]`, `channels[]`, `rules[]`, `standup`, `docs_url` |
| `find_person` | `GET /people?query=` | `items[].id`, `full_name` |
| `search_knowledge` | `GET /knowledge/search?query=&tags=a,b` | `items[].id`, `title`, `snippet` |
| `get_knowledge_article` | `GET /knowledge/{id}` | `id`, `title`, `body` |
| `get_onboarding_plan` | `GET /onboarding/plan?user_id=` | `stages[].tasks[]`: `id`, `code`, `title`, `link`, `status` |
| `get_onboarding_progress` | `GET /onboarding/progress?user_id=` | `percent`, `current_stage.title` |
| `get_next_steps` | `GET /onboarding/next-steps?user_id=` | `items[]`: `id`, `code`, `title`, `link` |
| `get_access_overview` | `GET /access/overview` | `systems[]`: `system`, `title`, `purpose`, `required`, `status` (`granted`\|`requested`\|`missing`) |
| `list_my_requests` | `GET /requests?type=&status=` | `items[]`: `id`, `type`, `status`, `payload`, `decision_comment` |
| `get_request` | `GET /requests/{id}` | то же |
| `list_pending_approvals` | `GET /approvals/pending` | `items[]`: `id`, `type`, `payload`, `user.full_name` |
| `create_leave_request` | `POST /requests/leave` `{date_from, date_to, reason_type, comment}` + `Idempotency-Key` | `id`, `status`, `payload`, `approver.full_name` |
| `create_access_request` | `POST /requests/access` `{system, reason}` + `Idempotency-Key` | `id`, `status`, `approver.full_name` |
| `update_task_status` | `PATCH /onboarding/tasks/{id}` `{status, comment}` | — |
| `approve_request` / `reject_request` | `POST /requests/{id}/approve` \| `/reject` `{comment}` | — |
| (история) | `POST /chat/messages` `{conversation_id, role, content}` | — |
| (метрики) | `POST /events` `{type, payload}` | — |

Ошибки: `{"error":{"code","message","details?"}}` с кодами `validation_error`, `forbidden`, `not_found`, `conflict`, `upstream_unavailable`. Признак `retryable` агент ищет в `error.retryable`, `error.details.retryable` или на верхнем уровне; любой 502–504 считает повторяемым.

## Запросы на подтверждение

1. **Запрос: `GET /auth/me` отвечает 401 на недействительный токен.** Агент сам JWT не разбирает и секрет не знает: так он проверяет токен и узнаёт `id` и `role` (кэш 60 с). `id` используется для привязки карточек действий к пользователю.
2. **Запрос: в `payload` заявки на отгул есть `date_from`, `date_to`, `reason_type`; у заявки на доступ — `system`.** По ним агент формулирует «Отгул 13 ноября (пятница)» и карточки руководителя.
3. **Запрос: в элементах `GET /approvals/pending` есть `user.full_name`.** Иначе руководитель увидит карточки без имени сотрудника.
4. **Запрос: в ответе создания заявки есть `approver.full_name`** (кто согласует). Если поля нет, агент делает лишний вызов `GET /me/profile` и берёт `lead.full_name` — работает, но медленнее.
5. **Запрос: у задачи «Получить доступы» в плане и в next-steps есть `code: "get_access"`.** По коду агент понимает, что её нельзя закрывать вручную. Запасной вариант — название содержит «получить доступ».
6. **Запрос: `POST /events` принимает любые строковые `type`.** Агент пишет: `question_asked`, `answered_from_kb`, `kb_miss`, `action_proposed`, `action_confirmed`, `action_failed`, `escalated_to_human`, а также `guard_refused` и `action_cancelled` (два последних — сверх постановки, полезны для метрик безопасности).
7. **Запрос: поиск `GET /knowledge/search` находит статью по 1–4 ключевым словам** («отгул», «код-ревью», «доступ Grafana»). Агент не отправляет вопрос целиком. Если поиск строгий (AND по всем словам), длинные запросы будут давать пустой результат и агент честно ответит «в базе нет» — лучше ранжирование по совпадениям (`websearch_to_tsquery` или OR).
8. **Идемпотентность, прошу учесть:**
   - первый вызов уходит с `Idempotency-Key = action_id`;
   - для карточки доступов ключ у каждой системы свой: `action_id:<system>`;
   - если API ответил ошибкой и пользователь подтвердил карточку ещё раз, ключ меняется на `action_id:r1`, `action_id:r2`… — иначе повтор после сбоя corp-mock мог бы вернуть сохранённую заявку `failed`;
   - на `PATCH /onboarding/tasks/{id}` и `approve` / `reject` заголовок тоже приходит — его можно игнорировать, операции и так идемпотентны по смыслу.
9. **Запрос: повторное одобрение уже одобренной заявки отвечает 200**, а не 409 — на случай повторного confirm после сетевого сбоя.
10. **Docker Compose:** сервисы агента ждут имена `api` (healthcheck обязателен, на него завязан `depends_on`) и `redis`. Блоки сервисов — в [`agent/compose.snippet.yml`](../agent/compose.snippet.yml). Переменные `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `TZ` нужно добавить в корневой `.env.example` (значения — в [`agent/.env.example`](../agent/.env.example)).
11. **Redis:** агент пишет ключи с префиксом `aibuddy:` (действия, история, rate limit) — с ключами API не пересекается.

## Чего агент не делает

- Не ходит в corp-mock и в PostgreSQL напрямую — только в REST API.
- Не имеет сервисного токена: без JWT пользователя не выполняется ни один запрос.
- Не кэширует данные пользователей между запросами (кроме роли на 60 с).
