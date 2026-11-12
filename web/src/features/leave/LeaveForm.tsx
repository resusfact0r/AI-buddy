import { config } from '@/config';
import { useState, type FormEvent } from 'react';
import {
  LEAVE_TYPE_LABEL,
  LeaveFormSchema,
  LeaveTypeSchema,
  daysInclusive,
  todayIso,
  type LeaveForm as LeaveValues,
} from '@/api/schemas';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { formatDay, pluralDays } from '@/lib/dates';
import { validate, type FieldErrors } from '@/lib/zodForm';

export interface LeaveFormProps {
  initial?: Partial<LeaveValues>;
  onSubmit: (values: LeaveValues) => void;
  onCancel?: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  /** Ошибки по полям от сервера (validation_error). */
  serverErrors?: FieldErrors;
}

/** Форма отгула — общая для карточки в чате и ручного оформления. */
export function LeaveForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel = 'Отправить заявку',
  cancelLabel = 'Отмена',
  pending,
  serverErrors,
}: LeaveFormProps) {
  const [values, setValues] = useState({
    date_from: initial?.date_from ?? '',
    date_to: initial?.date_to ?? '',
    leave_type: initial?.leave_type ?? 'day_off',
    comment: initial?.comment ?? '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...serverErrors, ...errors };

  const set = <K extends keyof typeof values>(k: K, v: (typeof values)[K]) => {
    setValues((s) => {
      const next = { ...s, [k]: v };
      // удобство: при выборе даты начала подтягиваем дату окончания
      if (k === 'date_from' && (!s.date_to || s.date_to < String(v))) next.date_to = String(v);
      return next;
    });
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = validate(LeaveFormSchema, { ...values, comment: values.comment || undefined });
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    if (!config.useMocks && r.data.date_from <= todayIso()) {
      setErrors({ date_from: 'Выберите дату в будущем' });
      return;
    }
    setErrors({});
    onSubmit(r.data);
  };

  const okRange = values.date_from && values.date_to && values.date_from <= values.date_to;
  const hint = (iso: string) => (iso ? formatDay(iso) : undefined);

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label="Заявка на отгул">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="С" error={shown.date_from} hint={hint(values.date_from)}>
          <input
            type="date"
            className="input"
            min={todayIso()}
            value={values.date_from}
            onChange={(e) => set('date_from', e.target.value)}
          />
        </Field>
        <Field label="По" error={shown.date_to} hint={hint(values.date_to)}>
          <input
            type="date"
            className="input"
            min={values.date_from || todayIso()}
            value={values.date_to}
            onChange={(e) => set('date_to', e.target.value)}
          />
        </Field>
      </div>
      <Field label="Тип" error={shown.leave_type}>
        <select
          className="input"
          value={values.leave_type}
          onChange={(e) => set('leave_type', LeaveTypeSchema.parse(e.target.value))}
        >
          {LeaveTypeSchema.options
            .filter((t) => config.useMocks || t !== 'sick_leave')
            .map((t) => (
              <option key={t} value={t}>
                {LEAVE_TYPE_LABEL[t]}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Комментарий (необязательно)" error={shown.comment}>
        <textarea
          className="input min-h-[64px] resize-y"
          rows={2}
          value={values.comment}
          onChange={(e) => set('comment', e.target.value)}
          placeholder="Например: семейные обстоятельства"
        />
      </Field>
      {okRange && (
        <p className="text-sm text-ink-soft">
          Итого: <b>{pluralDays(daysInclusive(values.date_from, values.date_to))}</b>
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
        )}
      </div>
    </form>
  );
}
