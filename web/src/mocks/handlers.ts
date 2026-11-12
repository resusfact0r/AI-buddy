import { http, HttpResponse, delay as mswDelay, type HttpResponseResolver } from 'msw';
import { config } from '@/config';
import type { ActionResult, ConfirmParams } from '@/api/schemas';
import { ARTICLES, PASSWORD, START_DATES, TEAMS, USERS } from './data';
import {
  accessFor,
  appendHistory,
  buddyOf,
  conversationFor,
  createAccess,
  createLeave,
  db,
  decide,
  historyFor,
  leadOf,
  MockHttpError,
  nextStepsFor,
  pendingFor,
  planFor,
  progressFor,
  registerAction,
  requestById,
  requestsFor,
  requireIntern,
  setActionResult,
  setTaskStatus,
  teamOf,
  toPerson,
  userById,
  userByToken,
  withIdempotency,
} from './db';
import { runScenario } from './agentScenario';

/** Масштаб задержек: 1 — «как в жизни» для демо, 0 — мгновенно в тестах. */
export const mockTiming = { scale: 1 };

const wait = async (ms: number) => {
  const t = ms * mockTiming.scale;
  if (t > 0) await mswDelay(t);
};

function errorResponse(e: unknown) {
  if (e instanceof MockHttpError) {
    return HttpResponse.json(
      { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } },
      { status: e.status },
    );
  }
  console.error('[mock] internal', e);
  return HttpResponse.json(
    { error: { code: 'internal', message: 'Внутренняя ошибка мока' } },
    { status: 500 },
  );
}

/** Обёртка: латентность + перевод MockHttpError в формат контракта. */
function safe(resolver: HttpResponseResolver, latency = 150): HttpResponseResolver {
  return async (info) => {
    await wait(latency);
    try {
      return await resolver(info);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

const A = (p: string) => `${config.apiUrl}${p}`;
const G = (p: string) => `${config.agentUrl}${p}`;

const authUser = (req: Request) => userByToken(req.headers.get('Authorization'));

export const backendHandlers = [
  http.post(
    A('/auth/login'),
    safe(async ({ request }) => {
      const body = (await request.json()) as { username?: string; password?: string };
      const user = USERS.find((u) => u.username === body.username?.trim());
      if (!user || body.password !== PASSWORD) {
        throw new MockHttpError(401, 'invalid_credentials', 'Неверный логин или пароль');
      }
      const { id, username, display_name, role, team_id } = user;
      return HttpResponse.json({
        access_token: `mock.${user.username}`,
        user: { id, username, display_name, role, team_id },
      });
    }, 300),
  ),
  http.get(
    A('/auth/me'),
    safe(({ request }) => {
      const { id, username, display_name, role, team_id } = authUser(request);
      return HttpResponse.json({ id, username, display_name, role, team_id });
    }),
  ),
  http.get(
    A('/me/profile'),
    safe(({ request }) => {
      const u = authUser(request);
      const team = teamOf(u);
      const buddy = u.role === 'intern' ? buddyOf(u) : null;
      const lead = u.role === 'lead' ? null : leadOf(u);
      return HttpResponse.json({
        user: {
          id: u.id,
          username: u.username,
          display_name: u.display_name,
          role: u.role,
          team_id: u.team_id,
        },
        team: team ? { id: team.id, name: team.name } : null,
        buddy: buddy ? toPerson(buddy) : null,
        lead: lead ? toPerson(lead) : null,
        start_date: START_DATES[u.id] ?? null,
      });
    }),
  ),
  http.get(
    A('/teams/:id'),
    safe(({ request, params }) => {
      authUser(request);
      const team = TEAMS.find((t) => t.id === params.id);
      if (!team) throw new MockHttpError(404, 'not_found', 'Команда не найдена');
      return HttpResponse.json({
        id: team.id,
        name: team.name,
        description: team.description,
        lead: toPerson(userById(team.lead_id)),
        members: USERS.filter((u) => u.team_id === team.id).map(toPerson),
      });
    }),
  ),
  http.get(
    A('/onboarding/plan'),
    safe(({ request }) => {
      const u = authUser(request);
      requireIntern(u);
      return HttpResponse.json({ stages: planFor(u.id) });
    }),
  ),
  http.get(
    A('/onboarding/progress'),
    safe(({ request }) => {
      const u = authUser(request);
      requireIntern(u);
      return HttpResponse.json(progressFor(u.id));
    }),
  ),
  http.get(
    A('/onboarding/next-steps'),
    safe(({ request }) => {
      const u = authUser(request);
      requireIntern(u);
      return HttpResponse.json(nextStepsFor(u.id));
    }),
  ),
  http.patch(
    A('/onboarding/tasks/:id'),
    safe(async ({ request, params }) => {
      const u = authUser(request);
      requireIntern(u);
      const body = (await request.json()) as { status?: string };
      if (body.status !== 'todo' && body.status !== 'in_progress' && body.status !== 'done') {
        throw new MockHttpError(400, 'validation_error', 'Неверный статус', {
          fields: { status: 'Неверный статус' },
        });
      }
      return HttpResponse.json(setTaskStatus(u.id, String(params.id), body.status));
    }),
  ),
  http.post(
    A('/requests/leave'),
    safe(async ({ request }) => {
      const u = authUser(request);
      const body = (await request.json()) as Parameters<typeof createLeave>[1];
      return HttpResponse.json(
        withIdempotency(request.headers.get('Idempotency-Key'), () => createLeave(u, body)),
        { status: 201 },
      );
    }, 300),
  ),
  http.get(
    A('/access/overview'),
    safe(({ request }) => {
      const u = authUser(request);
      requireIntern(u);
      return HttpResponse.json(accessFor(u));
    }),
  ),
  http.post(
    A('/requests/access'),
    safe(async ({ request }) => {
      const u = authUser(request);
      const body = (await request.json()) as { system_ids: string[]; reason: string };
      return HttpResponse.json(
        withIdempotency(request.headers.get('Idempotency-Key'), () => ({
          requests: createAccess(u, body.system_ids, body.reason),
        })),
        { status: 201 },
      );
    }, 300),
  ),
  http.get(
    A('/requests'),
    safe(({ request }) => {
      const u = authUser(request);
      const url = new URL(request.url);
      return HttpResponse.json({
        items: requestsFor(u, url.searchParams.get('type'), url.searchParams.get('status')),
      });
    }),
  ),
  http.get(
    A('/requests/:id'),
    safe(({ request, params }) => HttpResponse.json(requestById(authUser(request), String(params.id)))),
  ),
  http.get(
    A('/approvals/pending'),
    safe(({ request }) => HttpResponse.json({ items: pendingFor(authUser(request)) })),
  ),
  http.post(
    A('/requests/:id/approve'),
    safe(async ({ request, params }) => {
      const body = (await request.json().catch(() => ({}))) as { comment?: string };
      return HttpResponse.json(decide(authUser(request), String(params.id), 'approved', body.comment));
    }, 300),
  ),
  http.post(
    A('/requests/:id/reject'),
    safe(async ({ request, params }) => {
      const body = (await request.json().catch(() => ({}))) as { comment?: string };
      return HttpResponse.json(decide(authUser(request), String(params.id), 'rejected', body.comment));
    }, 300),
  ),
  http.get(
    A('/knowledge/:id'),
    safe(({ request, params }) => {
      authUser(request);
      const a = ARTICLES.find((x) => x.id === params.id);
      if (!a) throw new MockHttpError(404, 'not_found', 'Статья не найдена');
      return HttpResponse.json(a);
    }, 250),
  ),
  http.get(
    A('/chat/history'),
    safe(({ request }) => {
      const u = authUser(request);
      const messages = historyFor(u.id);
      return HttpResponse.json({ conversation_id: messages.length ? conversationFor(u.id) : null, messages });
    }),
  ),
];

const SUGGESTIONS = {
  intern: [
    'Что мне делать дальше?',
    'Хочу отгул в пятницу, надо предупреждать руководителя?',
    'Какие доступы мне нужны?',
    'Как у нас проходит код-ревью?',
  ],
  lead: ['Что мне согласовать?', 'Как оформить отгул?'],
  buddy: ['Как у нас проходит код-ревью?'],
};

const encoder = new TextEncoder();
const frame = (event: string, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export const agentHandlers = [
  http.get(
    G('/agent/suggestions'),
    safe(({ request }) => {
      const u = authUser(request);
      return HttpResponse.json({
        suggestions: SUGGESTIONS[u.role].map((text, i) => ({ id: `s${i + 1}`, text })),
      });
    }, 100),
  ),
  http.post(
    G('/agent/chat'),
    safe(async ({ request }) => {
      const u = authUser(request);
      const body = (await request.json()) as { message?: string; conversation_id?: string | null };
      const message = (body.message ?? '').trim();
      if (!message) {
        throw new MockHttpError(400, 'validation_error', 'Пустое сообщение', {
          fields: { message: 'Пустое сообщение' },
        });
      }
      const result = runScenario(u, message);
      if (result.outcome.kind === 'http_error') {
        throw new MockHttpError(
          503,
          'upstream_unavailable',
          'AI-buddy временно недоступен. Попробуйте ещё раз.',
        );
      }
      const conversationId = body.conversation_id ?? conversationFor(u.id);
      appendHistory(u.id, { role: 'user', content: message });
      for (const p of result.proposals) registerAction(u.id, p);
      const steps = result.outcome.steps;
      const hasError = steps.some((s) => s.event.type === 'error');
      const signal = request.signal;

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for (const s of steps) {
              await wait(s.delay);
              if (signal.aborted) return;
              controller.enqueue(frame(s.event.type, s.event.data));
            }
            if (!hasError) {
              appendHistory(u.id, {
                role: 'assistant',
                content: result.text,
                sources: result.sources,
                action: result.proposals[0] ?? null,
              });
              await wait(50);
              controller.enqueue(
                frame('done', { conversation_id: conversationId, message_id: crypto.randomUUID() }),
              );
            }
            controller.close();
          } catch {
            /* клиент отменил — поток уже закрыт */
          }
        },
      });
      return new HttpResponse(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }, 200),
  ),
  http.post(
    G('/agent/actions/:id/confirm'),
    safe(async ({ request, params }) => {
      const u = authUser(request);
      const id = String(params.id);
      const action = db.state.actions[id];
      if (!action || action.userId !== u.id) throw new MockHttpError(404, 'not_found', 'Действие не найдено');
      if (action.result && action.result.status !== 'failed') {
        throw new MockHttpError(409, 'conflict', 'Это действие уже выполнено');
      }
      const body = (await request.json().catch(() => ({}))) as { params?: ConfirmParams['params'] | null };
      const p = action.proposal;
      let result: ActionResult;
      try {
        switch (p.type) {
          case 'leave_request': {
            const params = { ...p.params, ...(body.params ?? {}) } as typeof p.params;
            const r = createLeave(u, params);
            result = {
              action_id: id,
              status: 'pending',
              message: 'Заявка создана и отправлена руководителю',
              request_ids: [r.id],
              request_numbers: [r.number],
            };
            break;
          }
          case 'access_request': {
            const edited = body.params as { system_ids?: string[]; reason?: string } | null | undefined;
            const ids = edited?.system_ids ?? p.params.systems.map((s) => s.id);
            const created = createAccess(u, ids, edited?.reason ?? p.params.reason ?? '');
            result = {
              action_id: id,
              status: 'pending',
              message: `Запросы отправлены руководителю: ${created.length}`,
              request_ids: created.map((r) => r.id),
              request_numbers: created.map((r) => r.number),
            };
            break;
          }
          case 'task_status': {
            setTaskStatus(u.id, p.params.task_id, p.params.status);
            result = { action_id: id, status: 'done', message: `Задача «${p.params.task_title}» выполнена` };
            break;
          }
          case 'approve':
          case 'reject': {
            const comment = (body.params as { comment?: string } | null)?.comment ?? undefined;
            const r = decide(u, p.params.request_id, p.type === 'approve' ? 'approved' : 'rejected', comment);
            result = {
              action_id: id,
              status: r.status,
              message: `Заявка ${r.number} ${r.status === 'approved' ? 'одобрена' : 'отклонена'}`,
              request_ids: [r.id],
              request_numbers: [r.number],
            };
            break;
          }
        }
      } catch (e) {
        if (e instanceof MockHttpError && e.status === 400) throw e;
        result = {
          action_id: id,
          status: 'failed',
          message: e instanceof Error ? e.message : 'Не удалось выполнить действие',
          retryable: !(e instanceof MockHttpError && (e.status === 409 || e.status === 403)),
        };
      }
      setActionResult(id, result);
      return HttpResponse.json(result);
    }, 500),
  ),
  http.post(
    G('/agent/actions/:id/cancel'),
    safe(({ request, params }) => {
      const u = authUser(request);
      const id = String(params.id);
      const action = db.state.actions[id];
      if (!action || action.userId !== u.id) throw new MockHttpError(404, 'not_found', 'Действие не найдено');
      setActionResult(id, { action_id: id, status: 'cancelled', message: 'Действие отменено' });
      return HttpResponse.json({ action_id: id, status: 'cancelled' });
    }),
  ),
];

export const handlers = [...backendHandlers, ...agentHandlers];
