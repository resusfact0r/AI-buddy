import type { ReactNode } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { formatDateTime } from '@/lib/dates';
import { RequestStatusBadge } from './status';
import { useRequest } from './hooks';
import { requestReason, requestSubject, requestTitle } from './describe';

function Item({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={className}>{children}</dd>
    </div>
  );
}

export function RequestDetails({ id, onClose }: { id: string; onClose: () => void }) {
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
        <dl className="space-y-3 text-body">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted">Статус</dt>
            <dd>
              <RequestStatusBadge status={q.data.status} />
            </dd>
          </div>
          <Item label="Тип" className="font-medium">
            {requestTitle(q.data)}
          </Item>
          <Item label={q.data.type === 'leave' ? 'Даты' : 'Система'} className="text-right font-medium">
            {requestSubject(q.data)}
          </Item>
          {requestReason(q.data) && (
            <Item label={q.data.type === 'leave' ? 'Комментарий' : 'Зачем'} className="text-right">
              {requestReason(q.data)}
            </Item>
          )}
          <Item label="Создана">{formatDateTime(q.data.created_at)}</Item>
          {q.data.decided_by && (
            <div className="rounded-2xl bg-canvas p-4">
              <dt className="text-sm font-semibold">
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
