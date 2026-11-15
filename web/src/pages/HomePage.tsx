import { useSession } from '@/stores/session';
import { SplitLayout } from '@/app/SplitLayout';
import { WelcomeCard } from '@/features/onboarding/WelcomeCard';
import { NextStepsCard } from '@/features/onboarding/NextStepsCard';
import { ProgressCard } from '@/features/onboarding/ProgressCard';
import { AccessWidget } from '@/features/access/AccessWidget';
import { LeadHome } from './LeadHome';

function InternHome() {
  return (
    <SplitLayout
      panelLabel="Адаптация"
      panel={
        <>
          <WelcomeCard />
          <NextStepsCard />
          <ProgressCard />
          <AccessWidget />
        </>
      }
    />
  );
}

export function HomePage() {
  const role = useSession((s) => s.user?.role);
  if (role === 'intern') return <InternHome />;
  if (role === 'lead') return <LeadHome />;
  return <SplitLayout panelLabel="Профиль" panel={<WelcomeCard />} />;
}
