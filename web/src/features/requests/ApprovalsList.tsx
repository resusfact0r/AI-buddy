import { useState } from 'react';
import { CalendarDays, Check, KeyRound, X } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkRequest } from '@/api/schemas';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { formatDateTime } from '@/lib/dates';
import { notifyError } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { useDecision, usePendingApprovals } from './hooks';
import { requestReason, requestSubject, requestTitle } from './describe';

function ApprovalCard({ r }: { r: WorkRequest }) {
  const m = useDecision();
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const decide = (decision: 'approve' | 'reject') =>
    m.mutate(
      { id: r.id, decision, comment: comment.trim() || undefined },
      {
        onSuccess: (res) =>
          toast.success(`${res.number}: ${decision === 'approve' ? 'одобрено' : 'отклонено'}`, {
            description: `${r.author.display_name} увидит решение сразу.`,
          }),
        onError: (e) => notifyError(e, () => decide(decision)),
      },
    );
  const Icon = r.type === 'leave' ? CalendarDays : KeyRound;
  const reason = requestReason(r);
  return (
    <li className="card animate-fade-up p-5">
      <div className="flex items-start gap-3">
        <Avatar name={r.author.display_name} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="font-bold">{r.author.display_name}</span>
            <span className="text-sm text-ink-muted">
              {r.number} · {formatDateTime(r.created_at)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className={cn(
                'grid h-7 w-7 place-items-center rounded-lg',
                r.type === 'leave' ? 'bg-brand-soft text-brand' : 'bg-violet-soft text-violet',
              )}
              aria-hidden
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="font-semibold">{requestTitle(r)}</span>
            {r.type === 'leave' && <span className="text-ink-soft">· {requestSubject(r)}</span>}
          </div>
          {reason && <p className="mt-1.5 text-sm text-ink-soft">«{reason}»</p>}
        </div>
      </div>
      {showComment && (
        <Field label="Комментарий для сотрудника" className="mt-3">
          <textarea
            className="input min-h-[56px]"
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="success"
          onClick={() => decide('approve')}
          disabled={m.isPending}
          aria-label={`Одобрить ${r.number}`}
        >
          <Check className="h-4 w-4" aria-hidden /> Одобрить
        </Button>
        <Button
          variant="danger"
          onClick={() => decide('reject')}
          disabled={m.isPending}
          aria-label={`Отклонить ${r.number}`}
        >
          <X className="h-4 w-4" aria-hidden /> Отклонить
        </Button>
        {!showComment && (
          <Button variant="ghost" onClick={() => setShowComment(true)}>
            Добавить комментарий
          </Button>
        )}
      </div>
    </li>
  );
}

export function ApprovalsList({ compact }: { compact?: boolean }) {
  const q = usePendingApprovals();
  if (q.isPending) return <SkeletonCard lines={3} />;
  if (q.isError)
    return (
      <div className="card">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  if (q.data.items.length === 0)
    return (
      <div className="card">
        <EmptyState title="Всё согласовано 🎉" text="Новые заявки стажёров появятся здесь автоматически." />
      </div>
    );
  const items = compact ? q.data.items.slice(0, 4) : q.data.items;
  return (
    <ul className="space-y-3" aria-label="Заявки на согласование">
      {items.map((r) => (
        <ApprovalCard key={r.id} r={r} />
      ))}
    </ul>
  );
}
