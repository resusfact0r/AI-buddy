import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { AccessFormSchema, type AccessForm } from '@/api/schemas';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { validate, type FieldErrors } from '@/lib/zodForm';

export interface AccessOption {
  id: string;
  name: string;
  purpose?: string | null;
}

export interface AccessRequestFormProps {
  systems: AccessOption[];
  initialSelected?: string[];
  initialReason?: string | null;
  onSubmit: (values: AccessForm) => void;
  onCancel?: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  serverErrors?: FieldErrors;
}

/** Выбор систем + «зачем нужен доступ». Общая для карточки в чате и экрана «Мои доступы». */
export function AccessRequestForm({
  systems,
  initialSelected,
  initialReason,
  onSubmit,
  onCancel,
  submitLabel = 'Запросить выбранные',
  cancelLabel = 'Отменить',
  pending,
  serverErrors,
}: AccessRequestFormProps) {
  const [selected, setSelected] = useState<string[]>(initialSelected ?? systems.map((s) => s.id));
  const [reason, setReason] = useState(initialReason ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...serverErrors, ...errors };

  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    setErrors((e) => ({ ...e, system_ids: '' }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = validate(AccessFormSchema, { system_ids: selected, reason });
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    onSubmit(r.data);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label="Запрос доступов">
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold text-ink-soft">Системы</legend>
        <ul className="space-y-1.5">
          {systems.map((s) => {
            const on = selected.includes(s.id);
            return (
              <li key={s.id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                    on ? 'border-brand bg-brand-soft/50' : 'border-line hover:bg-canvas',
                  )}
                >
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={on}
                    onChange={() => toggle(s.id)}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand',
                      on ? 'border-brand bg-brand text-white' : 'border-line bg-white',
                    )}
                  >
                    {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{s.name}</span>
                    {s.purpose && <span className="block text-sm text-ink-soft">{s.purpose}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {shown.system_ids && (
          <p role="alert" className="mt-1 text-xs font-medium text-danger">
            {shown.system_ids}
          </p>
        )}
      </fieldset>
      <Field label="Зачем нужен доступ" error={shown.reason}>
        <textarea
          className="input min-h-16 resize-y"
          rows={2}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setErrors((x) => ({ ...x, reason: '' }));
          }}
          placeholder="Например: задачи первой недели по плану адаптации"
        />
      </Field>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" loading={pending} disabled={selected.length === 0}>
          {submitLabel}
          {selected.length > 0 && (
            <span className="rounded-md bg-white/25 px-1.5 text-xs">{selected.length}</span>
          )}
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
