import { MessageCircle } from 'lucide-react';
import type { Person } from '@/api/schemas';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { useProfile } from './hooks';

function daysSince(iso: string): number {
  const start = new Date(`${iso}T00:00:00`);
  return Math.max(1, Math.floor((Date.now() - start.getTime()) / 86_400_000) + 1);
}

function PersonCard({ role, person }: { role: string; person: Person | null }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-canvas px-4 py-3">
      {person ? (
        <Avatar name={person.display_name} className="h-11 w-11" />
      ) : (
        <span className="h-11 w-11 shrink-0 rounded-full bg-line" />
      )}
      <div className="min-w-0 leading-tight">
        <div className="eyebrow">{role}</div>
        <div className="mt-0.5 truncate font-bold">{person?.display_name ?? 'Не назначен'}</div>
        {person?.contact && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-sm text-ink-soft">
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
            {person.contact}
          </div>
        )}
      </div>
    </div>
  );
}

export function WelcomeCard() {
  const q = useProfile();
  if (q.isPending) {
    return (
      <div className="card space-y-4 p-6" role="status" aria-label="Загрузка профиля">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-5 w-1/3" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-[68px]" />
          <Skeleton className="h-[68px]" />
        </div>
      </div>
    );
  }
  if (q.isError) return <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />;
  const { user, team, buddy, lead, start_date } = q.data;
  const first = user.display_name.split(' ')[0];
  return (
    <section className="card p-6 sm:p-7" aria-labelledby="welcome-title">
      <h1
        id="welcome-title"
        className="text-[34px] font-extrabold leading-tight tracking-tight sm:text-[44px]"
      >
        <span className="mark mark-green">Привет, {first}! 👋</span>
      </h1>
      <p className="mt-4 text-lg font-medium text-ink-soft">
        {team ? (
          <>
            Команда <b className="font-bold text-ink">«{team.name}»</b>
          </>
        ) : (
          'Команда не назначена'
        )}
        {start_date && <> · {daysSince(start_date)}-й день в компании</>}
      </p>
      {user.role === 'intern' && (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PersonCard role="Наставник" person={buddy} />
          <PersonCard role="Руководитель" person={lead} />
        </div>
      )}
    </section>
  );
}
