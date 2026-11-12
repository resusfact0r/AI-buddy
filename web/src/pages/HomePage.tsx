import { useEffect, useState } from 'react';
import { useSession } from '@/stores/session';
import { useChatFocus } from '@/stores/chat';
import { cn } from '@/lib/cn';
import { ChatPanel } from '@/features/chat/ChatPanel';
import { WelcomeCard } from '@/features/onboarding/WelcomeCard';
import { NextStepsCard } from '@/features/onboarding/NextStepsCard';
import { ProgressCard } from '@/features/onboarding/ProgressCard';
import { AccessWidget } from '@/features/access/AccessWidget';
import { LeadHome } from './LeadHome';

type Tab = 'panel' | 'chat';

/** Две колонки на десктопе; на узком экране — вкладки «Адаптация» / «AI-buddy». */
export function SplitLayout({ panel, panelLabel }: { panel: React.ReactNode; panelLabel: string }) {
  const [tab, setTab] = useState<Tab>('panel');
  const focusNonce = useChatFocus((s) => s.nonce);
  useEffect(() => {
    if (focusNonce > 0) setTab('chat');
  }, [focusNonce]);

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={tab === id}
      aria-controls={`pane-${id}`}
      onClick={() => setTab(id)}
      className={cn(
        'flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
        tab === id ? 'bg-white text-ink shadow-card' : 'text-ink-soft',
      )}
    >
      {label}
    </button>
  );

  return (
    <>
      <div
        role="tablist"
        aria-label="Разделы главной"
        className="mb-4 flex gap-1 rounded-2xl bg-line/60 p-1 lg:hidden"
      >
        {tabBtn('panel', panelLabel)}
        {tabBtn('chat', 'AI-buddy')}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div id="pane-panel" className={cn('min-w-0 space-y-4', tab !== 'panel' && 'hidden lg:block')}>
          {panel}
        </div>
        <div id="pane-chat" className={cn('min-w-0', tab !== 'chat' && 'hidden lg:block')}>
          <ChatPanel className="h-[calc(100dvh-12rem)] min-h-[520px] lg:sticky lg:top-[5.5rem] lg:h-[calc(100dvh-7.5rem)]" />
        </div>
      </div>
    </>
  );
}

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
