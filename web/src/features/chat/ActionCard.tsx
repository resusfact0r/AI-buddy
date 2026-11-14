import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  CheckCircle2,
  KeyRound,
  ListChecks,
  Pencil,
  RotateCw,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { LEAVE_TYPE_LABEL, daysInclusive, type ActionProposal } from '@/api/schemas';
import { useChat, type ActionState } from '@/stores/chat';
import { useSession } from '@/stores/session';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { LeaveForm } from '@/features/leave/LeaveForm';
import { AccessRequestForm } from '@/features/access/AccessRequestForm';
import { ActionResultBadge } from '@/features/requests/status';
import { formatRange, pluralDays } from '@/lib/dates';
import { cn } from '@/lib/cn';

const META: Record<ActionProposal['type'], { title: string; icon: typeof CalendarDays; accent: string }> = {
  leave_request: { title: 'Заявка на отгул', icon: CalendarDays, accent: 'bg-brand text-ink' },
  access_request: { title: 'Запрос доступов', icon: KeyRound, accent: 'bg-violet text-white' },
  task_status: { title: 'План адаптации', icon: ListChecks, accent: 'bg-ok text-ink' },
  approve: { title: 'Одобрить заявку', icon: ThumbsUp, accent: 'bg-ok text-ink' },
  reject: { title: 'Отклонить заявку', icon: ThumbsDown, accent: 'bg-danger text-white' },
};

export function ActionCard({ action }: { action: ActionState }) {
  const { proposal, phase } = action;
  const meta = META[proposal.type];
  return (
    <section
      aria-label={proposal.title ?? meta.title}
      className={cn(
        'mt-3 animate-fade-up overflow-hidden rounded-2xl bg-white ring-inset',
        phase === 'cancelled' ? 'opacity-60 ring-1 ring-line' : 'ring-2 ring-ink',
      )}
    >
      <header className="flex items-center gap-3 px-4 pt-4">
        <span className={cn('grid h-9 w-9 place-items-center rounded-[10px]', meta.accent)} aria-hidden>
          <meta.icon className="h-4 w-4" />
        </span>
        <h3 className="flex-1 text-lg font-extrabold">{proposal.title ?? meta.title}</h3>
        {phase === 'result' && action.result && <ActionResultBadge status={action.result.status} />}
        {phase === 'cancelled' && <ActionResultBadge status="cancelled" />}
      </header>
      <div className="p-4">
        {phase === 'result' && action.result ? (
          <ResultView action={action} />
        ) : phase === 'cancelled' ? (
          <p className="text-sm text-ink-soft">Действие отменено — ничего не отправлено.</p>
        ) : (
          <ProposalBody action={action} />
        )}
      </div>
    </section>
  );
}

function ConfirmError({ action, onRetry }: { action: ActionState; onRetry: () => void }) {
  if (!action.error) return null;
  return (
    <div
      role="alert"
      className="mb-3 flex items-center gap-3 rounded-xl bg-danger-soft px-3 py-2.5 text-sm font-semibold text-ink"
    >
      <span className="flex-1">{action.error.message}</span>
      {action.error.retryable && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden /> Повторить
        </Button>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1 text-[15px]">
      <dt className="w-28 shrink-0 text-ink-soft">{label}</dt>
      <dd className="min-w-0 flex-1 font-bold">{children}</dd>
    </div>
  );
}

function ProposalBody({ action }: { action: ActionState }) {
  const confirm = useChat((s) => s.confirmAction);
  const cancel = useChat((s) => s.cancelAction);
  const p = action.proposal;
  const id = p.action_id;
  const submitting = action.phase === 'submitting';
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');

  switch (p.type) {
    case 'leave_request': {
      const v = p.params;
      if (editing) {
        return (
          <>
            <ConfirmError action={action} onRetry={() => void confirm(id)} />
            <LeaveForm
              initial={{ ...v, comment: v.comment ?? undefined }}
              submitLabel="Подтвердить"
              cancelLabel="Отменить правки"
              pending={submitting}
              onCancel={() => setEditing(false)}
              onSubmit={(params) => void confirm(id, { type: 'leave_request', params })}
            />
          </>
        );
      }
      return (
        <>
          <ConfirmError action={action} onRetry={() => void confirm(id)} />
          <dl>
            <Row label="Даты">
              {formatRange(v.date_from, v.date_to)}{' '}
              <span className="font-normal text-ink-muted">
                · {pluralDays(daysInclusive(v.date_from, v.date_to))}
              </span>
            </Row>
            <Row label="Тип">{LEAVE_TYPE_LABEL[v.leave_type]}</Row>
            {v.comment && <Row label="Комментарий">{v.comment}</Row>}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void confirm(id)} loading={submitting}>
              Подтвердить
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)} disabled={submitting}>
              <Pencil className="h-4 w-4" aria-hidden /> Изменить
            </Button>
            <Button variant="ghost" onClick={() => void cancel(id)} disabled={submitting}>
              Отменить
            </Button>
          </div>
        </>
      );
    }
    case 'access_request':
      return (
        <>
          <ConfirmError action={action} onRetry={() => void confirm(id)} />
          <AccessRequestForm
            systems={p.params.systems}
            initialReason={p.params.reason}
            pending={submitting}
            onCancel={() => void cancel(id)}
            onSubmit={(params) => void confirm(id, { type: 'access_request', params })}
          />
        </>
      );
    case 'task_status':
      return (
        <>
          <ConfirmError action={action} onRetry={() => void confirm(id)} />
          <p className="text-[15px]">
            Отметить задачу <b>«{p.params.task_title}»</b> выполненной?
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="success" onClick={() => void confirm(id)} loading={submitting}>
              Да, выполнена
            </Button>
            <Button variant="secondary" onClick={() => void cancel(id)} disabled={submitting}>
              Нет
            </Button>
          </div>
        </>
      );
    case 'approve':
    case 'reject': {
      const v = p.params;
      const isApprove = p.type === 'approve';
      return (
        <>
          <ConfirmError
            action={action}
            onRetry={() => void confirm(id, { type: p.type, params: { comment } })}
          />
          <dl>
            <Row label="Заявка">{v.request_number}</Row>
            <Row label="Автор">{v.author_name}</Row>
            <Row label={v.request_type === 'leave' ? 'Даты' : 'Система'}>{v.summary}</Row>
            {v.reason && <Row label="Причина">{v.reason}</Row>}
          </dl>
          <Field label="Комментарий (необязательно)" className="mt-2">
            <textarea
              className="input min-h-[56px] resize-y"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button
              variant={isApprove ? 'success' : 'danger'}
              loading={submitting}
              onClick={() => void confirm(id, comment ? { type: p.type, params: { comment } } : undefined)}
            >
              {isApprove ? 'Подтвердить одобрение' : 'Подтвердить отказ'}
            </Button>
            <Button variant="secondary" onClick={() => void cancel(id)} disabled={submitting}>
              Отменить
            </Button>
          </div>
        </>
      );
    }
  }
}

function ResultView({ action }: { action: ActionState }) {
  const confirm = useChat((s) => s.confirmAction);
  const role = useSession((s) => s.user?.role);
  const r = action.result!;
  const p = action.proposal;
  if (r.status === 'failed') {
    return (
      <div role="alert">
        <p className="text-[15px] font-semibold text-danger-strong">
          {r.message ?? 'Не удалось выполнить действие.'}
        </p>
        {r.retryable && (
          <Button className="mt-3" variant="outline" size="sm" onClick={() => void confirm(p.action_id)}>
            <RotateCw className="h-3.5 w-3.5" aria-hidden /> Повторить
          </Button>
        )}
      </div>
    );
  }
  const numbers = r.request_numbers ?? [];
  const isRequest = p.type === 'leave_request' || p.type === 'access_request';
  return (
    <div className="flex items-start gap-3 rounded-xl bg-ok-soft p-3.5" role="status">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-[15px]">
        <p className="font-bold">{r.message ?? 'Готово'}</p>
        {p.type === 'leave_request' && (
          <p className="text-ink/70">{formatRange(p.params.date_from, p.params.date_to)}</p>
        )}
        {numbers.length > 0 && (
          <p className="text-sm text-ink/70">
            {numbers.length > 1 ? 'Заявки' : 'Заявка'} {numbers.join(', ')}
          </p>
        )}
        {isRequest && role === 'intern' && (
          <Link
            to="/requests"
            className="mt-1 inline-block text-sm font-bold text-ink underline underline-offset-2"
          >
            Открыть в моих заявках →
          </Link>
        )}
        {p.type === 'task_status' && role === 'intern' && (
          <Link
            to="/plan"
            className="mt-1 inline-block text-sm font-bold text-ink underline underline-offset-2"
          >
            Открыть план →
          </Link>
        )}
      </div>
    </div>
  );
}
