import { http as mswHttp, HttpResponse } from 'msw';
import { z } from 'zod';
import { server } from '@/mocks/server';
import { config } from '@/config';
import { useSession } from '@/stores/session';
import { loginAs } from '@/test/utils';
import { ApiError, extractFieldErrors, FORBIDDEN_MESSAGE, kindFromResponse, toApiError } from './errors';
import { backendApi } from './backend';
import { buildUrl, request } from './http';

const url = (p: string) => `${config.apiUrl}${p}`;
const err = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });

async function catchErr(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected rejection');
}

describe('http client', () => {
  beforeEach(() => loginAs('intern_anna'));

  it('добавляет Authorization и разбирает ответ по схеме', async () => {
    let auth: string | null = null;
    server.use(
      mswHttp.get(url('/x'), ({ request: r }) => {
        auth = r.headers.get('Authorization');
        return HttpResponse.json({ a: 1 });
      }),
    );
    await expect(request(config.apiUrl, '/x', { schema: z.object({ a: z.number() }) })).resolves.toEqual({
      a: 1,
    });
    expect(auth).toBe('Bearer mock.intern_anna');
  });

  it('401 → разлогин с причиной expired', async () => {
    server.use(mswHttp.get(url('/x'), () => err(401, 'unauthorized', 'nope')));
    const e = await catchErr(request(config.apiUrl, '/x', { schema: z.unknown() }));
    expect(e.kind).toBe('unauthorized');
    expect(useSession.getState().token).toBeNull();
    expect(useSession.getState().logoutReason).toBe('expired');
  });

  it('401 на логине не разлогинивает (skipAuthRedirect)', async () => {
    const e = await catchErr(backendApi.login({ username: 'intern_anna', password: 'bad' }));
    expect(e.kind).toBe('unauthorized');
    expect(e.code).toBe('invalid_credentials');
    expect(useSession.getState().token).not.toBeNull();
  });

  it('403 → «Недостаточно прав для этого действия»', async () => {
    const e = await catchErr(backendApi.pendingApprovals());
    expect(e.kind).toBe('forbidden');
    expect(e.message).toBe(FORBIDDEN_MESSAGE);
    expect(e.retryable).toBe(false);
  });

  it('409 → сообщение с бэкенда', async () => {
    const e = await catchErr(backendApi.updateTask('get-access', 'done'));
    expect(e.kind).toBe('conflict');
    expect(e.message).toMatch(/закрывается автоматически/);
  });

  it('validation_error → ошибки по полям', async () => {
    const e = await catchErr(
      backendApi.createLeave({ date_from: '2020-01-01', date_to: '2020-01-01', leave_type: 'day_off' }),
    );
    expect(e.kind).toBe('validation');
    expect(e.fieldErrors.date_from).toMatch(/прошлом/);
  });

  it('upstream_unavailable / 5xx → retryable', async () => {
    server.use(mswHttp.get(url('/x'), () => err(503, 'upstream_unavailable', 'LLM недоступна')));
    const e = await catchErr(request(config.apiUrl, '/x', { schema: z.unknown() }));
    expect(e.kind).toBe('upstream');
    expect(e.retryable).toBe(true);
    expect(e.message).toBe('LLM недоступна');

    server.use(mswHttp.get(url('/y'), () => new HttpResponse('oops', { status: 502 })));
    const e2 = await catchErr(request(config.apiUrl, '/y', { schema: z.unknown() }));
    expect(e2.kind).toBe('upstream');
    expect(e2.message).toMatch(/временно недоступен/);
  });

  it('сетевая ошибка → network, retryable', async () => {
    server.use(mswHttp.get(url('/x'), () => HttpResponse.error()));
    const e = await catchErr(request(config.apiUrl, '/x', { schema: z.unknown() }));
    expect(e.kind).toBe('network');
    expect(e.retryable).toBe(true);
  });

  it('таймаут → timeout', async () => {
    server.use(
      mswHttp.get(url('/slow'), async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({});
      }),
    );
    const e = await catchErr(request(config.apiUrl, '/slow', { schema: z.unknown(), timeoutMs: 20 }));
    expect(e.kind).toBe('timeout');
  });

  it('ответ не по контракту → bad_response', async () => {
    server.use(mswHttp.get(url('/x'), () => HttpResponse.json({ a: 'str' })));
    const e = await catchErr(request(config.apiUrl, '/x', { schema: z.object({ a: z.number() }) }));
    expect(e.kind).toBe('bad_response');
  });

  it('Idempotency-Key передаётся при создании заявки', async () => {
    let key: string | null = null;
    server.use(
      mswHttp.post(url('/requests/leave'), ({ request: r }) => {
        key = r.headers.get('Idempotency-Key');
        return err(400, 'validation_error', 'bad');
      }),
    );
    await catchErr(
      backendApi.createLeave(
        { date_from: '2030-01-01', date_to: '2030-01-01', leave_type: 'day_off' },
        'k-1',
      ),
    );
    expect(key).toBe('k-1');
  });

  it('пользовательская отмена пробрасывается как AbortError', async () => {
    server.use(
      mswHttp.get(url('/slow'), async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({});
      }),
    );
    const ctrl = new AbortController();
    const p = request(config.apiUrl, '/slow', { schema: z.unknown(), signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('errors helpers', () => {
  it('buildUrl пропускает пустые параметры', () => {
    expect(buildUrl('http://h', '/r', { a: 'x', b: '', c: undefined, d: null })).toBe('http://h/r?a=x');
    expect(buildUrl('http://h', 'r')).toBe('http://h/r');
  });

  it('kindFromResponse', () => {
    expect(kindFromResponse(404)).toBe('not_found');
    expect(kindFromResponse(422)).toBe('validation');
    expect(kindFromResponse(418)).toBe('unknown');
    expect(kindFromResponse(500)).toBe('upstream');
  });

  it('extractFieldErrors — все форматы', () => {
    expect(extractFieldErrors({ fields: { a: 'x' } })).toEqual({ a: 'x' });
    expect(extractFieldErrors({ a: 'x', b: 1 })).toEqual({ a: 'x' });
    expect(extractFieldErrors([{ field: 'a', message: 'x' }, 'junk'])).toEqual({ a: 'x' });
    expect(extractFieldErrors(null)).toEqual({});
  });

  it('toApiError', () => {
    const e = new ApiError({ kind: 'conflict', status: 409, code: 'conflict', message: 'm' });
    expect(toApiError(e)).toBe(e);
    expect(toApiError(new DOMException('t', 'TimeoutError')).kind).toBe('timeout');
    expect(toApiError(new TypeError('x')).kind).toBe('network');
  });
});
