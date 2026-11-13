# AI-buddy: ИИ-агент и MCP-сервер (Бэкенд 2)

Сервис агента отвечает стажёру в чате, а действия выполняет через MCP-инструменты — с правами самого пользователя и только после подтверждения.

```
web :3000 ──JWT──▶ agent :8081 ──JWT──▶ mcp :8082 ──JWT──▶ api :8080 ──▶ corp-mock :8090
                     │   ▲                                   └─ RBAC: права проверяются здесь
                     │   └─ LLM (OpenAI-совместимый API или mock)
                     └─ Redis: карточки действий (TTL 30 мин), история, rate limit
```

| Что | Где |
|---|---|
| Контракт для фронта | [`docs/agent-api.md`](../docs/agent-api.md) |
| SDD-спецификации поведения | [`specs/`](../specs/README.md) |
| Eval-набор и отчёт | [`evals/`](../evals/README.md) |
| На какой контракт API опирается агент | [`docs/agent-contract-requests.md`](../docs/agent-contract-requests.md) |
| Схема, метрики, план пилота | [`docs/agent-presentation.md`](../docs/agent-presentation.md) |

## Запуск

**Вместе со всем проектом** — сервисы `agent` и `mcp` из [`compose.snippet.yml`](compose.snippet.yml) входят в общий `docker-compose.yml`:

```bash
cp .env.example .env && docker compose up --build
```

**Только агент, без основного API** — вместо него поднимается имитация с синтетическими данными:

```bash
docker compose -f agent/docker-compose.standalone.yml up --build
# или без Docker (нужен Go 1.26+):
cd agent && make run-mock
```

Проверка:

```bash
TOKEN=$(curl -s localhost:8080/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"login":"intern_anna","password":"test1234"}' | jq -r .access_token)
curl -N localhost:8081/api/v1/agent/chat -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"message":"Хочу отгул в пятницу"}'
```

## LLM

Агент работает с любым OpenAI-совместимым API (`POST /chat/completions`, function calling, стриминг).

| Переменная | Значение по умолчанию | Назначение |
|---|---|---|
| `LLM_PROVIDER` | `mock`, если нет ключа | `openai` — реальная модель, `mock` — детерминированный LLM на правилах |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | адрес API |
| `LLM_MODEL` | `openai/gpt-4o-mini` | модель; нужна поддержка function calling |
| `LLM_API_KEY` | пусто | ключ |

По умолчанию указаны сервис **OpenRouter** и модель **openai/gpt-4o-mini**. Это настройка по умолчанию, а не проверенная связка: с реальной моделью агент в этой среде не запускался (не было ключа). Подойдёт любой совместимый сервис: поменяйте три переменные.

**Подключить свой ключ:** в `.env` задайте `LLM_PROVIDER=openai`, `LLM_API_KEY=…` и при необходимости `LLM_BASE_URL`, `LLM_MODEL`, затем `docker compose up -d agent`.

**Mock-режим.** Если `LLM_API_KEY` пуст, агент сам включает `mock` и пишет об этом в лог — проект запускается и проходит все сценарии без ключа и сети. Mock определяет намерение по правилам и вызывает те же MCP-инструменты, что и настоящая модель, поэтому права, карточки и подтверждения работают одинаково. Активный провайдер виден в `GET /healthz` (`"llm":"mock"`).

## Остальные переменные

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `API_BASE_URL` | `http://localhost:8080` | основной API (в compose — `http://api:8080`) |
| `MCP_URL` | `http://localhost:8082` | MCP-сервер (в compose — `http://mcp:8082`) |
| `REDIS_URL` | пусто | Redis; без него состояние хранится в памяти процесса |
| `AGENT_ADDR` / `MCP_ADDR` | `:8081` / `:8082` | адреса сервисов |
| `TZ` | системный | часовой пояс для «завтра», «в пятницу» |
| `CORS_ORIGINS` | `*` | разрешённый Origin фронта |
| `AGENT_MAX_TOOL_CALLS` | `5` | максимум вызовов инструментов на запрос |
| `AGENT_TIMEOUT_SEC` / `LLM_TIMEOUT_SEC` / `TOOL_TIMEOUT_SEC` | `30` / `20` / `5` | таймауты запроса, LLM, инструмента |
| `AGENT_HISTORY_LIMIT` | `10` | сколько последних сообщений видит модель |
| `AGENT_MAX_MESSAGE_LEN` | `2000` | лимит длины сообщения |
| `AGENT_RATE_LIMIT` / `AGENT_RATE_WINDOW_SEC` | `20` / `60` | rate limit на пользователя |
| `AGENT_PENDING_TTL_SEC` | `1800` | время жизни карточки |

Пример без секретов — [`.env.example`](.env.example).

## MCP-инструменты

Транспорт — Streamable HTTP, `http://localhost:8082/mcp`. JWT пользователя передаётся заголовком `Authorization: Bearer …` и уходит в API без изменений. Набор инструментов в `tools/list` зависит от роли владельца токена.

| Инструмент | Сценарий | Тип | Кому |
|---|---|---|---|
| `get_my_profile` | все | чтение | все |
| `get_team_info` | 3 | чтение | все |
| `find_person` | 3, эскалация | чтение | все |
| `search_knowledge`, `get_knowledge_article` | 1, 3, 4 | чтение | все |
| `get_onboarding_plan`, `get_onboarding_progress`, `get_next_steps` | 2 | чтение | все |
| `get_access_overview` | 4 | чтение | все |
| `list_my_requests`, `get_request` | 1, 4 | чтение | все |
| `list_pending_approvals` | 1, 4 | чтение | lead |
| `create_leave_request` | 1 | действие | все |
| `create_access_request` | 4 | действие | все |
| `update_task_status` | 2 | действие | intern |
| `approve_request`, `reject_request` | 1, 4 | действие | lead |

У каждого инструмента строгая JSON-схема (`additionalProperties: false`), таймаут 5 с, ошибки API сводятся к короткому тексту без стектрейсов и чужих данных. Чтение помечено `readOnlyHint: true`; всё остальное агент превращает в карточку и вызывает только после confirm, передавая `action_id` как ключ идемпотентности (`_meta.idempotency_key` → заголовок `Idempotency-Key`).

**Показать в MCP Inspector:**

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP, URL: http://localhost:8082/mcp
# Header: Authorization: Bearer <токен стажёра или руководителя>
```

С токеном стажёра в списке 14 инструментов, с токеном руководителя — 16. Для отладки есть stdio: `MCP_USER_TOKEN=<JWT> ./bin/mcp -stdio`.

## Права и защита

- **Один токен на всю цепочку.** Сервисного пользователя нет: без JWT агент не делает ни одного запроса, права проверяет RBAC основного API.
- **Фильтр по роли.** Стажёр не видит `approve_request` ни в списке инструментов, ни в промпте модели. Если модель его «выдумает», вызов не выполнится.
- **Подтверждение.** Изменения идут только по цепочке `action_proposal` → `confirm`. Карточка привязана к пользователю, живёт 30 минут; повторный confirm возвращает сохранённый результат.
- **Guard на входе.** Prompt injection, чужие персональные данные, финансовые операции и темы вне работы отклоняются до обращения к LLM. Вопросы об оценке, конфликтах, здоровье и деньгах уходят к человеку с черновиком сообщения.
- **Данные ≠ инструкции.** Ответы инструментов оборачиваются в `<tool_result>` с пометкой; вложенные теги вырезаются.
- **Guard на выходе.** Потоковый фильтр вычищает JWT и ключи и обрывает ответ, если модель начала цитировать системный промпт.
- **Сбои.** Не больше 5 вызовов инструментов и 30 с на запрос, один повтор LLM при 5xx/таймауте, событие `error` с `retryable` — сервис не падает.

## Тесты и качество

```bash
cd agent
make test       # все тесты
make coverage   # coverage.out + coverage.html, в конце — итоговый процент
make lint       # gofmt + go vet (+ golangci-lint, если установлен)
make evals      # eval-набор; с LLM_API_KEY — на реальной модели
```

- **Покрытие: 93% строк** нашего кода в `internal/` (цель кейса — больше 80%). Не считаются `cmd/*/main.go`, зависимости и сами тесты. Отчёт: `agent/coverage.html`.
- **Сценарные тесты** (`internal/scenario`) проверяют критерии приёмки из `specs/`: в имени теста стоит идентификатор критерия, например `TestAC_01_3_LeaveClarifyDate`. Они поднимают полную цепочку agent → MCP → API в одном процессе.
- **Юнит-тесты:** инструменты с моком API, разбор относительных дат, guard, фильтр ролей, хранилище (в том числе Redis через miniredis), идемпотентность, нормализация ошибок, OpenAI-клиент со стримингом.
- **Evals:** 26 кейсов, на mock — 26 из 26. На реальной модели не прогонялись.

## Почему Go

Агент и MCP-сервер написаны на Go 1.26 с официальным MCP SDK `github.com/modelcontextprotocol/go-sdk`: один стек с основным API и с бэкендом Авито, один образ на оба сервиса (около 35 МБ), стандартный `net/http` без фреймворков. Запасной вариант на Python не понадобился.

## Структура

```
agent/
  cmd/agent      сервис агента: чат (SSE), confirm/cancel, подсказки
  cmd/mcp        MCP-сервер (Streamable HTTP, -stdio для отладки)
  cmd/evals      прогон eval-набора
  cmd/fakeapi    имитация основного API для автономной разработки
  internal/
    orchestrator цикл LLM ↔ инструменты, карточки, подтверждение
    tools        реестр MCP-инструментов, схемы, нормализация ошибок
    mcpclient    агент как MCP-клиент
    llm          интерфейс Client, OpenAI-совместимый клиент, mock
    guard        проверка входа, обёртка данных, фильтр вывода
    prompts      системный промпт и контекст пользователя
    knowledge    учёт источников RAG
    dates        разбор «в пятницу», «завтра», «с 14 по 16 ноября»
    store        Redis и in-memory: карточки, история, rate limit
    apiclient    клиент основного API
    httpapi      HTTP API и SSE
    scenario     сценарные тесты по specs/
    evals        раннер eval-набора
    fakeapi      in-memory имитация API (синтетические данные)
```

## Ограничения

- **Интеграция с настоящим API проверена на mock-LLM** (сквозной прогон всего стека, 13.11.2026): результаты и открытые вопросы — в [`docs/qa-report.md`](../docs/qa-report.md).
- **С реальной LLM агент не запускался** — не было ключа. Проверены OpenAI-клиент (на тестовом сервере) и вся логика на mock.
- RAG — полнотекстовый поиск основного API; эмбеддинги не делались.
- История диалога для модели хранится в Redis 24 часа и зеркалится в `POST /chat/messages`; чтение истории из основного API не используется.
