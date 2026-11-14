import { ApprovalsList } from '@/features/requests/ApprovalsList';
import { usePendingApprovals } from '@/features/requests/hooks';

export function ApprovalsPage() {
  const q = usePendingApprovals();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="page-title">Заявки на согласование</h1>
        <p className="mt-1 text-lg font-medium text-ink-soft">
          {q.data ? `Ждут решения: ${q.data.items.length}` : 'Отгулы и доступы стажёров вашей команды'}
        </p>
      </div>
      <ApprovalsList />
    </div>
  );
}
