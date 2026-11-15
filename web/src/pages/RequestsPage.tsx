import { useState } from 'react';
import { Plus } from 'lucide-react';
import { RequestStatusSchema, RequestTypeSchema, type RequestStatus, type RequestType } from '@/api/schemas';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { QueryView } from '@/components/ui/QueryView';
import { Segmented } from '@/components/ui/Segmented';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/States';
import { LeaveDialog } from '@/features/leave/LeaveDialog';
import { RequestDetails } from '@/features/requests/RequestDetails';
import { RequestRow } from '@/features/requests/RequestRow';
import { useRequests } from '@/features/requests/hooks';
import { REQUEST_TYPE_META } from '@/features/requests/requestType';

const STATUS_LABEL: Record<RequestStatus, string> = {
  failed: 'Ошибка',
  pending: 'На согласовании',
  approved: 'Одобрены',
  rejected: 'Отклонены',
};

const TYPE_OPTIONS = [
  { value: '' as const, label: 'Все типы' },
  ...RequestTypeSchema.options.map((t) => ({ value: t, label: REQUEST_TYPE_META[t].label })),
];
const STATUS_OPTIONS = [
  { value: '' as const, label: 'Все статусы' },
  ...RequestStatusSchema.options.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
];

export function RequestsPage() {
  const [type, setType] = useState<RequestType | ''>('');
  const [status, setStatus] = useState<RequestStatus | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const q = useRequests({ type, status });

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Мои заявки"
        description="Отгулы и доступы. Статус обновляется автоматически."
        actions={
          <Button onClick={() => setLeaveOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Оформить отгул вручную
          </Button>
        }
      />
      <div className="flex flex-wrap gap-3">
        <Segmented label="Тип заявки" value={type} onChange={setType} options={TYPE_OPTIONS} />
        <Segmented label="Статус заявки" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </div>
      <QueryView query={q} loading={<SkeletonCard lines={4} />}>
        {(data) =>
          data.items.length === 0 ? (
            <div className="card">
              <EmptyState
                title={type || status ? 'Нет заявок по фильтру' : 'Заявок пока нет'}
                text="Оформите отгул или запросите доступ — через AI-buddy или вручную."
              />
            </div>
          ) : (
            <ul className="card divide-y divide-line overflow-hidden" aria-label="Список заявок">
              {data.items.map((r) => (
                <RequestRow key={r.id} r={r} onOpen={() => setOpenId(r.id)} />
              ))}
            </ul>
          )
        }
      </QueryView>
      {openId && <RequestDetails id={openId} onClose={() => setOpenId(null)} />}
      {leaveOpen && <LeaveDialog onClose={() => setLeaveOpen(false)} />}
    </div>
  );
}
