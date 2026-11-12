import type { ZodType, ZodTypeDef } from 'zod';

export type FieldErrors = Record<string, string>;

/** Прогоняет значения через Zod-схему и возвращает либо данные, либо ошибки по полям. */
export function validate<T>(
  schema: ZodType<T, ZodTypeDef, unknown>,
  values: unknown,
): { ok: true; data: T } | { ok: false; errors: FieldErrors } {
  const r = schema.safeParse(values);
  if (r.success) return { ok: true, data: r.data };
  const errors: FieldErrors = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
