import { ApiErrorBodySchema } from './schemas';

export type ApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'upstream'
  | 'network'
  | 'timeout'
  | 'bad_response'
  | 'unknown';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  /** Ошибки по полям формы (для validation_error). */
  readonly fieldErrors: Record<string, string>;

  constructor(opts: {
    kind: ApiErrorKind;
    status: number;
    code: string;
    message: string;
    details?: unknown;
  }) {
    super(opts.message);
    this.name = 'ApiError';
    this.kind = opts.kind;
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
    this.fieldErrors = extractFieldErrors(opts.details);
  }

  /** Имеет смысл предложить «Повторить». */
  get retryable(): boolean {
    return this.kind === 'upstream' || this.kind === 'network' || this.kind === 'timeout';
  }
}

export const FORBIDDEN_MESSAGE = 'Недостаточно прав для этого действия';
const UPSTREAM_MESSAGE = 'Сервис временно недоступен. Попробуйте ещё раз через минуту.';

/**
 * details для validation_error поддерживаем в двух формах:
 *   { fields: { date_to: "..." } }  или  { date_to: "..." }  или  [{ field, message }]
 */
export function extractFieldErrors(details: unknown): Record<string, string> {
  if (!details || typeof details !== 'object') return {};
  if (Array.isArray(details)) {
    const out: Record<string, string> = {};
    for (const item of details) {
      if (item && typeof item === 'object' && 'field' in item && 'message' in item) {
        out[String(item.field)] = String(item.message);
      }
    }
    return out;
  }
  const source =
    'fields' in details && details.fields && typeof details.fields === 'object'
      ? (details.fields as Record<string, unknown>)
      : (details as Record<string, unknown>);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (typeof v === 'string') out[k] = v;
  return out;
}

export function kindFromResponse(status: number, code?: string): ApiErrorKind {
  if (code === 'validation_error') return 'validation';
  if (code === 'upstream_unavailable') return 'upstream';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  if (status === 502 || status === 503 || status === 504 || status >= 500) return 'upstream';
  return 'unknown';
}

/** Превращает HTTP-ответ с ошибкой в ApiError. Тело читается, если это JSON нужного формата. */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* тело не JSON — используем статус */
  }
  const parsed = ApiErrorBodySchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : `http_${res.status}`;
  const kind = kindFromResponse(res.status, parsed.success ? parsed.data.error.code : undefined);
  let message = parsed.success ? parsed.data.error.message : `Ошибка сервера (${res.status})`;
  if (kind === 'forbidden') message = FORBIDDEN_MESSAGE;
  if (kind === 'upstream' && !parsed.success) message = UPSTREAM_MESSAGE;
  return new ApiError({
    kind,
    status: res.status,
    code,
    message,
    details: parsed.success ? parsed.data.error.details : undefined,
  });
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof DOMException && e.name === 'TimeoutError') {
    return new ApiError({ kind: 'timeout', status: 0, code: 'timeout', message: 'Сервер долго не отвечает' });
  }
  return new ApiError({
    kind: 'network',
    status: 0,
    code: 'network',
    message: 'Нет связи с сервером. Проверьте подключение.',
  });
}
