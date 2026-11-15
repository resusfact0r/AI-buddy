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
    <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-canvas px-3 py-2.5">
      {person ? (
        <Avatar name={person.display_name} />
      ) : (
        <span className="h-10 w-10 shrink-0 rounded-full bg-line" />
      )}
      <div className="min-w-0 leading-tight">
        <div className="text-xs text-ink-muted">{role}</div>
        <div className="truncate font-semibold">{person?.display_name ?? 'Не назначен'}</div>
        {person?.contact && (
          <div className="flex items-center gap-1 truncate text-xs text-ink-soft">
            <MessageCircle className="h-3 w-3" aria-hidden />
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
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>
    );
  }
  if (q.isError) return <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />;
  const { user, team, buddy, lead, start_date } = q.data;
  const first = user.display_name.split(' ')[0];
  return (
    <section className="card overflow-hidden" aria-labelledby="welcome-title">
      <div className="bg-brand-soft px-6 pb-5 pt-6">
        <h1 id="welcome-title" className="text-title font-bold">
          Привет, {first}
        </h1>
        <p className="mt-1 text-ink-soft">
          {team ? (
            <>
              Команда <b className="text-ink">«{team.name}»</b>
            </>
          ) : (
            'Команда не назначена'
          )}
          {start_date && <> · {daysSince(start_date)}-й день в компании</>}
        </p>
      </div>
      {user.role === 'intern' && (
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          <PersonCard role="Наставник" person={buddy} />
          <PersonCard role="Руководитель" person={lead} />
        </div>
      )}
    </section>
  );
}
