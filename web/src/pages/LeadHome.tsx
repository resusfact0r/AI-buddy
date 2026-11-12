import { Link } from 'react-router-dom';
import { WelcomeCard } from '@/features/onboarding/WelcomeCard';
import { ApprovalsList } from '@/features/requests/ApprovalsList';
import { usePendingApprovals } from '@/features/requests/hooks';
import { SplitLayout } from './HomePage';

function PendingHeader() {
  const q = usePendingApprovals();
  const n = q.data?.items.length ?? 0;
  return (
    <div className="flex items-baseline justify-between px-1 pt-2">
      <h2 className="text-lg font-bold">
        Ждут вашего решения{' '}
        {n > 0 && <span className="ml-1 rounded-full bg-warn-soft px-2 py-0.5 text-sm text-warn">{n}</span>}
      </h2>
      <Link to="/approvals" className="text-sm font-semibold text-brand hover:underline">
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
