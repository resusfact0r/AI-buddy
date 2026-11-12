import { normalizeBackend, normalizeAgent } from './wire';
import type { ZodType, ZodTypeDef } from 'zod';
import { config } from '@/config';
import { useSession } from '@/stores/session';
import { ApiError, errorFromResponse, toApiError } from './errors';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions<T> {
  method?: Method;
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  schema: ZodType<T, ZodTypeDef, unknown>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Не разлогинивать на 401 (например, сам запрос логина). */
  skipAuthRedirect?: boolean;
}

export function buildUrl(base: string, path: string, query?: RequestOptions<unknown>['query']): string {
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export function authHeaders(): Record<string, string> {
  const token = useSession.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Общая реакция на 401: чистим сессию, роутер увидит это и отправит на /login. */
export function handleUnauthorized(): void {
  useSession.getState().logout('expired');
}

function combineSignals(signals: (AbortSignal | undefined)[]): AbortSignal {
  const list = signals.filter((s): s is AbortSignal => Boolean(s));
  if (list.length === 1) return list[0]!;
  const ctrl = new AbortController();
  for (const s of list) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/** Типизированный запрос: ответ всегда проходит через Zod-схему. */
export async function request<T>(base: string, path: string, opts: RequestOptions<T>): Promise<T> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? config.requestTimeoutMs);
  const signal = combineSignals([timeout, opts.signal]);
  let res: Response;
  try {
    res = await fetch(buildUrl(base, path, opts.query), {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e; // отмена пользователем — пробрасываем как есть
    throw toApiError(timeout.aborted ? new DOMException('timeout', 'TimeoutError') : e);
  }

  if (!res.ok) {
    const err = await errorFromResponse(res);
    if (err.kind === 'unauthorized' && !opts.skipAuthRedirect) handleUnauthorized();
    throw err;
  }

  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  const parsed = opts.schema.safeParse(
    config.useMocks
      ? data
      : !path.startsWith('/agent/')
        ? normalizeBackend(path, data)
        : normalizeAgent(path.endsWith('/suggestions') ? 'suggestions' : 'action_result', data),
  );
  if (!parsed.success) {
    console.error('[api] Ответ не соответствует контракту', path, parsed.error.issues);
    throw new ApiError({
      kind: 'bad_response',
      status: res.status,
      code: 'bad_response',
      message: 'Сервер вернул неожиданный ответ',
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}

export const backendHttp = <T>(path: string, opts: RequestOptions<T>) => request(config.apiUrl, path, opts);
export const agentHttp = <T>(path: string, opts: RequestOptions<T>) => request(config.agentUrl, path, opts);

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
