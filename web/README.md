# AI-buddy — веб-интерфейс

React 18 + TypeScript (strict) + Vite · TanStack Query · React Router · Zustand · Zod · Tailwind + Radix · Vitest + Testing Library + MSW.

## Требования

- Node.js **≥ 20** (проверено на 22.14), npm **≥ 10** (проверено на 11.7)

## Запуск

```bash
npm i
cp .env.example .env   # по умолчанию VITE_USE_MOCKS=true
npm run dev            # http://localhost:3000
```

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8080/api/v1` | Бэкенд 1 (REST) |
| `VITE_AGENT_URL` | `http://localhost:8081/api/v1` | Бэкенд 2 (ИИ-агент, SSE) |
| `VITE_USE_MOCKS` | `false` | `true` — все запросы обрабатывает MSW в браузере |

### Режим моков

`VITE_USE_MOCKS=true` — фронт работает целиком без бэкендов: MSW-хендлеры реализуют оба контракта
(`src/mocks/handlers.ts`), включая SSE-стрим агента со всеми типами событий и реалистичными задержками.
Бизнес-логика моков (`src/mocks/db.ts`): права ролей, 409 на повторный запрос доступа и на ручное закрытие
«Получить доступы», автозакрытие этой задачи после выдачи всех обязательных доступов, idempotency.

Данные моков сохраняются в `localStorage`; сброс к исходным — в консоли браузера `__resetMockDb()`.

Тестовые пользователи (пароль `test1234`): `intern_anna`, `intern_boris`, `intern_vera`, `buddy_dmitry`,
`lead_elena`, `lead_fedor`. На экране входа — кнопки быстрого входа.

Для демонстрации сбоев в моках: сообщение с `[сбой]` — первый запрос вернёт 503 (повтор пройдёт),
с `[ошибка]` — событие `error` внутри стрима.

Переключение на реальные бэкенды — только `VITE_USE_MOCKS=false`, компоненты не меняются.

## Проверки

```bash
npm run lint           # ESLint + Prettier
npm run typecheck
npm run test
npm run test:coverage  # отчёт: coverage/index.html (покрытие строк ~97%)
```

## Docker

Многостадийная сборка: Vite → nginx (порт 3000). Адреса API подставляются **при старте контейнера**
в `/env.js` (`docker/40-runtime-env.sh`), поэтому один образ работает с любыми адресами:

```bash
docker build -t ai-buddy-web .
docker run -p 3000:3000 -e API_URL=http://localhost:8080/api/v1 -e AGENT_URL=http://localhost:8081/api/v1 ai-buddy-web
docker run -p 3000:3000 -e USE_MOCKS=true ai-buddy-web   # демо без бэкендов
```

В общем `docker-compose.yml` в корне репозитория — сервис `web` (переменные `WEB_API_URL`, `WEB_AGENT_URL`, `WEB_USE_MOCKS`).

## Структура `src/`

```
api/          явный API-клиент
  http.ts       fetch-обёртка: JWT, таймаут, разбор ошибок (401/403/409/validation/upstream)
  errors.ts     ApiError и классификация ошибок
  schemas.ts    Zod-схемы всех ответов и форм, типы через z.infer
  backend.ts    типизированные функции Бэкенда 1
  agent.ts      типизированные функции Бэкенда 2, POST /agent/chat → SSE
  sse.ts        парсер text/event-stream поверх fetch + ReadableStream (отмена, обрыв, таймаут)
  queryKeys.ts  ключи TanStack Query
stores/       Zustand: session (токен, пользователь), chat (сообщения, стрим, действия)
features/
  chat/         ChatPanel, Message, Composer, ActionCard (5 типов действий), SourceChips
  onboarding/   приветствие, следующие шаги, прогресс, хуки плана (оптимистичные обновления)
  access/       форма запроса доступов (общая для чата и экрана), виджет
  leave/        форма отгула (общая для чата и ручного оформления)
  requests/     статусы, хуки заявок и согласований, список согласований
  knowledge/    боковая панель статьи
pages/        экраны: вход, главная (стажёр / руководитель), чат, план, доступы, заявки, согласования
app/          роутинг по ролям, провайдеры, оболочка, префетч
components/   UI-примитивы и Markdown (без сырого HTML)
mocks/        MSW: данные, «БД» с бизнес-правилами, сценарии агента
lib/          даты, тосты, валидация форм
```

Контракты: [`../docs/openapi.yaml`](../docs/openapi.yaml) (Бэкенд 1) и [`../docs/agent-api.md`](../docs/agent-api.md) (агент). Zod-схемы фронта ещё не сверены с ними — пока используйте режим моков.
