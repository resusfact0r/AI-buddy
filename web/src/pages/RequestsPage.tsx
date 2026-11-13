import { useState } from 'react';
import { CalendarDays, ChevronRight, KeyRound, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  RequestStatusSchema,
  RequestTypeSchema,
  type RequestStatus,
  type RequestType,
  type WorkRequest,
} from '@/api/schemas';
import { toApiError } from '@/api/errors';
import { newIdempotencyKey } from '@/api/http';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { LeaveForm } from '@/features/leave/LeaveForm';
import { RequestStatusBadge } from '@/features/requests/status';
import { useCreateLeave, useRequest, useRequests } from '@/features/requests/hooks';
import { requestReason, requestSubject, requestTitle } from '@/features/requests/describe';
import { formatDateTime } from '@/lib/dates';
import { notifyError } from '@/lib/toast';
import { cn } from '@/lib/cn';

const TYPE_LABEL: Record<RequestType, string> = { leave: 'Отгулы', access: 'Доступы' };
const STATUS_LABEL: Record<RequestStatus, string> = {
  failed: 'Ошибка',
  pending: 'На согласовании',
  approved: 'Одобрены',
  rejected: 'Отклонены',
};

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | '';
  options: { value: T | ''; label: string }[];
  onChange: (v: T | '') => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-full bg-line p-1">
      {options.map((o) => (
        <button
          key={o.value || 'all'}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full px-4 py-2 text-sm font-bold transition-colors',
            value === o.value ? 'bg-ink text-white' : 'text-ink hover:bg-white/60',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RequestRow({ r, onOpen }: { r: WorkRequest; onOpen: () => void }) {
  const Icon = r.type === 'leave' ? CalendarDays : KeyRound;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-canvas/70 sm:px-6"
      >
        <span
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
            r.type === 'leave' ? 'bg-brand-soft text-ink' : 'bg-violet-soft text-ink',
          )}
          aria-hidden
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-bold">{requestTitle(r)}</span>
          <span className="block text-sm text-ink-soft">
            {r.type === 'leave' ? requestSubject(r) : (r.access.reason ?? '')}
          </span>
        </span>
        <span className="hidden text-right text-xs text-ink-muted sm:block">
          {r.number}
          <br />
          {formatDateTime(r.created_at)}
        </span>
        <RequestStatusBadge status={r.status} />
        <ChevronRight className="h-5 w-5 text-ink" aria-hidden />
      </button>
    </li>
  );
}

function RequestDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useRequest(id);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={q.data ? `Заявка ${q.data.number}` : 'Заявка'}>
      {q.isPending ? (
        <div className="space-y-2" role="status" aria-label="Загрузка заявки">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <dl className="space-y-3 text-[15px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-soft">Статус</dt>
            <dd>
              <RequestStatusBadge status={q.data.status} />
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft">Тип</dt>
            <dd className="font-bold">{requestTitle(q.data)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft">{q.data.type === 'leave' ? 'Даты' : 'Система'}</dt>
            <dd className="text-right font-bold">{requestSubject(q.data)}</dd>
          </div>
          {requestReason(q.data) && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">{q.data.type === 'leave' ? 'Комментарий' : 'Зачем'}</dt>
              <dd className="text-right">{requestReason(q.data)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft">Создана</dt>
            <dd>{formatDateTime(q.data.created_at)}</dd>
          </div>
          {q.data.decided_by && (
            <div className="rounded-2xl bg-canvas p-4">
              <dt className="text-sm font-bold">
                {q.data.status === 'approved' ? 'Одобрил(а)' : 'Отклонил(а)'}:{' '}
                {q.data.decided_by.display_name}
                {q.data.decided_at && (
                  <span className="font-normal text-ink-muted"> · {formatDateTime(q.data.decided_at)}</span>
                )}
              </dt>
              <dd className="mt-1 text-ink-soft">{q.data.decision_comment || 'Без комментария'}</dd>
            </div>
          )}
          {q.data.status === 'pending' && (
            <p className="text-sm text-ink-muted">
              Статус обновится автоматически, как только руководитель примет решение.
            </p>
          )}
        </dl>
      )}
    </Modal>
  );
}

function LeaveDialog({ onClose }: { onClose: () => void }) {
  const m = useCreateLeave();
  const [key] = useState(newIdempotencyKey);
  const err = m.error ? toApiError(m.error) : null;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Оформить отгул"
      description="Заявка уйдёт руководителю на согласование."
    >
      {err && err.kind !== 'validation' && (
        <p role="alert" className="mb-3 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger-strong">
          {err.message}
        </p>
      )}
      <LeaveForm
        pending={m.isPending}
        serverErrors={err?.fieldErrors}
        onCancel={onClose}
        onSubmit={(values) =>
          m.mutate(
            { values, idempotencyKey: key },
            {
              onSuccess: (r) => {
                toast.success(`Заявка ${r.number} создана`, {
                  description: 'Отправлена руководителю на согласование.',
                });
                onClose();
              },
              onError: (e) => {
                if (toApiError(e).retryable) notifyError(e);
              },
            },
          )
        }
      />
    </Modal>
  );
}

export function RequestsPage() {
  const [type, setType] = useState<RequestType | ''>('');
  const [status, setStatus] = useState<RequestStatus | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const q = useRequests({ type, status });

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Мои заявки</h1>
          <p className="mt-1 text-lg font-medium text-ink-soft">
            Отгулы и доступы. Статус обновляется автоматически.
          </p>
        </div>
        <Button onClick={() => setLeaveOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden /> Оформить отгул вручную
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Segmented
          label="Тип заявки"
          value={type}
          onChange={setType}
          options={[
            { value: '', label: 'Все типы' },
            ...RequestTypeSchema.options.map((t) => ({ value: t, label: TYPE_LABEL[t] })),
          ]}
        />
        <Segmented
          label="Статус заявки"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'Все статусы' },
            ...RequestStatusSchema.options.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
          ]}
        />
      </div>
      {q.isPending ? (
        <SkeletonCard lines={4} />
      ) : q.isError ? (
        <div className="card">
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : q.data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            title={type || status ? 'Нет заявок по фильтру' : 'Заявок пока нет'}
            text="Оформите отгул или запросите доступ — через AI-buddy или вручную."
          />
        </div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden" aria-label="Список заявок">
          {q.data.items.map((r) => (
            <RequestRow key={r.id} r={r} onOpen={() => setOpenId(r.id)} />
          ))}
        </ul>
      )}
      {openId && <RequestDetails id={openId} onClose={() => setOpenId(null)} />}
      {leaveOpen && <LeaveDialog onClose={() => setLeaveOpen(false)} />}
    </div>
  );
}
