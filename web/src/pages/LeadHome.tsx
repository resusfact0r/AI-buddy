import { Link } from 'react-router-dom';
import { WelcomeCard } from '@/features/onboarding/WelcomeCard';
import { ApprovalsList } from '@/features/requests/ApprovalsList';
import { usePendingApprovals } from '@/features/requests/hooks';
import { SplitLayout } from './HomePage';

function PendingHeader() {
  const q = usePendingApprovals();
  const n = q.data?.items.length ?? 0;
  return (
    <div className="flex items-baseline justify-between px-1 pt-3">
      <h2 className="text-2xl font-extrabold">
        Ждут вашего решения{' '}
        {n > 0 && (
          <span className="ml-1 rounded-md bg-brand px-2 py-0.5 align-middle text-base text-ink">{n}</span>
        )}
      </h2>
      <Link to="/approvals" className="text-sm font-bold text-ink underline underline-offset-2">
        Все заявки →
      </Link>
    </div>
  );
}

export function LeadHome() {
  return (
    <SplitLayout
      panelLabel="Согласования"
      panel={
        <>
          <WelcomeCard />
          <PendingHeader />
          <ApprovalsList compact />
        </>
      }
    />
  );
}
