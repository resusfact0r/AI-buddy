import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  ListChecks,
  Pencil,
  RotateCw,
  ThumbsDown,
  ThumbsUp,
  type LucideIcon,
} from 'lucide-react';
import { LEAVE_TYPE_LABEL, daysInclusive, type ActionProposal, type ConfirmParams } from '@/api/schemas';
import { useChat, type ActionState } from '@/stores/chat';
import { useSession } from '@/stores/session';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { IconTile } from '@/components/ui/IconTile';
import { InlineAlert } from '@/components/ui/InlineAlert';
import type { Tone } from '@/components/ui/Badge';
import { LeaveForm } from '@/features/leave/LeaveForm';
import { AccessRequestForm } from '@/features/access/AccessRequestForm';
import { ActionResultBadge } from '@/features/requests/status';
import { REQUEST_TYPE_META } from '@/features/requests/requestType';
import { formatRange, pluralDays } from '@/lib/dates';
import { cn } from '@/lib/cn';

const META: Record<ActionProposal['type'], { title: string; icon: LucideIcon; tone: Tone }> = {
  leave_request: { title: 'Заявка на отгул', ...REQUEST_TYPE_META.leave },
  access_request: { title: 'Запрос доступов', ...REQUEST_TYPE_META.access },
  task_status: { title: 'План адаптации', icon: ListChecks, tone: 'ok' },
  approve: { title: 'Одобрить заявку', icon: ThumbsUp, tone: 'ok' },
  reject: { title: 'Отклонить заявку', icon: ThumbsDown, tone: 'danger' },
};

export function ActionCard({ action }: { action: ActionState }) {
  const { proposal, phase } = action;
  const meta = META[proposal.type];
  return (
    <section
      aria-label={proposal.title ?? meta.title}
      className={cn(
        'mt-3 animate-fade-up overflow-hidden rounded-2xl border bg-white',
        phase === 'cancelled' ? 'border-line opacity-70' : 'border-line shadow-card',
      )}
    >
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <IconTile icon={meta.icon} tone={meta.tone} size="sm" />
        <h3 className="flex-1 font-bold">{proposal.title ?? meta.title}</h3>
        {phase === 'result' && action.result && <ActionResultBadge status={action.result.status} />}
        {phase === 'cancelled' && <ActionResultBadge status="cancelled" />}
      </header>
      <div className="px-4 py-3.5">
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
    <InlineAlert
      action={
        action.error.retryable && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCw className="h-3.5 w-3.5" aria-hidden /> Повторить
          </Button>
        )
      }
    >
      {action.error.message}
    </InlineAlert>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1 text-body">
      <dt className="w-28 shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium">{children}</dd>
    </div>
  );
}

type Proposal<T extends ActionProposal['type']> = Extract<ActionProposal, { type: T }>;

function useActionControls(action: ActionState) {
  const confirm = useChat((s) => s.confirmAction);
  const cancel = useChat((s) => s.cancelAction);
  const id = action.proposal.action_id;
  return {
    submitting: action.phase === 'submitting',
    confirm: (edited?: ConfirmParams) => void confirm(id, edited),
    cancel: () => void cancel(id),
  };
}

function LeaveProposal({ action, p }: { action: ActionState; p: Proposal<'leave_request'> }) {
  const { submitting, confirm, cancel } = useActionControls(action);
  const [editing, setEditing] = useState(false);
  const v = p.params;
  const error = <ConfirmError action={action} onRetry={() => confirm()} />;
  if (editing) {
    return (
      <>
        {error}
        <LeaveForm
          initial={{ ...v, comment: v.comment ?? undefined }}
          submitLabel="Подтвердить"
          cancelLabel="Отменить правки"
          pending={submitting}
          onCancel={() => setEditing(false)}
          onSubmit={(params) => confirm({ type: 'leave_request', params })}
        />
      </>
    );
  }
  return (
    <>
      {error}
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
        <Button onClick={() => confirm()} loading={submitting}>
          Подтвердить
        </Button>
        <Button variant="outline" onClick={() => setEditing(true)} disabled={submitting}>
          <Pencil className="h-4 w-4" aria-hidden /> Изменить
        </Button>
        <Button variant="ghost" onClick={cancel} disabled={submitting}>
          Отменить
        </Button>
      </div>
    </>
  );
}

function AccessProposal({ action, p }: { action: ActionState; p: Proposal<'access_request'> }) {
  const { submitting, confirm, cancel } = useActionControls(action);
  return (
    <>
      <ConfirmError action={action} onRetry={() => confirm()} />
      <AccessRequestForm
        systems={p.params.systems}
        initialReason={p.params.reason}
        pending={submitting}
        onCancel={cancel}
        onSubmit={(params) => confirm({ type: 'access_request', params })}
      />
    </>
  );
}

function TaskProposal({ action, p }: { action: ActionState; p: Proposal<'task_status'> }) {
  const { submitting, confirm, cancel } = useActionControls(action);
  return (
    <>
      <ConfirmError action={action} onRetry={() => confirm()} />
      <p className="text-body">
        Отметить задачу <b>«{p.params.task_title}»</b> выполненной?
      </p>
      <div className="mt-3 flex gap-2">
        <Button variant="success" onClick={() => confirm()} loading={submitting}>
          Да, выполнена
        </Button>
        <Button variant="secondary" onClick={cancel} disabled={submitting}>
          Нет
        </Button>
      </div>
    </>
  );
}

function DecisionProposal({ action, p }: { action: ActionState; p: Proposal<'approve' | 'reject'> }) {
  const { submitting, confirm, cancel } = useActionControls(action);
  const [comment, setComment] = useState('');
  const v = p.params;
  const isApprove = p.type === 'approve';
  return (
    <>
      <ConfirmError action={action} onRetry={() => confirm({ type: p.type, params: { comment } })} />
      <dl>
        <Row label="Заявка">{v.request_number}</Row>
        <Row label="Автор">{v.author_name}</Row>
        <Row label={v.request_type === 'leave' ? 'Даты' : 'Система'}>{v.summary}</Row>
        {v.reason && <Row label="Причина">{v.reason}</Row>}
      </dl>
      <Field label="Комментарий (необязательно)" className="mt-2">
        <textarea
          className="input min-h-14 resize-y"
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </Field>
      <div className="mt-3 flex gap-2">
        <Button
          variant={isApprove ? 'success' : 'danger'}
          loading={submitting}
          onClick={() => confirm(comment ? { type: p.type, params: { comment } } : undefined)}
        >
          {isApprove ? 'Подтвердить одобрение' : 'Подтвердить отказ'}
        </Button>
        <Button variant="secondary" onClick={cancel} disabled={submitting}>
          Отменить
        </Button>
      </div>
    </>
  );
}

function ProposalBody({ action }: { action: ActionState }) {
  const p = action.proposal;
  switch (p.type) {
    case 'leave_request':
      return <LeaveProposal action={action} p={p} />;
    case 'access_request':
      return <AccessProposal action={action} p={p} />;
    case 'task_status':
      return <TaskProposal action={action} p={p} />;
    case 'approve':
    case 'reject':
      return <DecisionProposal action={action} p={p} />;
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
        <p className="text-body text-danger">{r.message ?? 'Не удалось выполнить действие.'}</p>
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
    <div className="flex items-start gap-3" role="status">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />
      <div className="min-w-0 flex-1 text-body">
        <p className="font-semibold">{r.message ?? 'Готово'}</p>
        {p.type === 'leave_request' && (
          <p className="text-ink-soft">{formatRange(p.params.date_from, p.params.date_to)}</p>
        )}
        {numbers.length > 0 && (
          <p className="text-sm text-ink-muted">
            {numbers.length > 1 ? 'Заявки' : 'Заявка'} {numbers.join(', ')}
          </p>
        )}
        {isRequest && role === 'intern' && (
          <Link to="/requests" className="mt-1 inline-block text-sm font-semibold text-brand hover:underline">
            Открыть в моих заявках →
          </Link>
        )}
        {p.type === 'task_status' && role === 'intern' && (
          <Link to="/plan" className="mt-1 inline-block text-sm font-semibold text-brand hover:underline">
            Открыть план →
          </Link>
        )}
      </div>
    </div>
  );
}
