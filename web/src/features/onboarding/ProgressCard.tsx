import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { cn } from '@/lib/cn';
import { useProgress } from './hooks';

export function ProgressCard() {
  const q = useProgress();
  if (q.isPending) return <SkeletonCard lines={2} />;
  if (q.isError) return <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  return (
    <section className="card p-5" aria-labelledby="progress-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="progress-title" className="text-lg font-bold">
          Прогресс адаптации
        </h2>
        <Link to="/plan" className="text-sm font-semibold text-brand hover:underline">
          Весь план →
        </Link>
      </div>
      <div className="mt-3 flex items-end gap-3">
        <span className="text-4xl font-extrabold tabular-nums tracking-tight">{p.percent}%</span>
        <span className="pb-1.5 text-sm text-ink-soft">
          {p.done_tasks} из {p.total_tasks} обязательных задач
        </span>
      </div>
      <div
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-canvas"
        role="progressbar"
        aria-valuenow={p.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Общий прогресс"
      >
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#0099F7,#965EEB)] transition-[width] duration-700 ease-out"
          style={{ width: `${p.percent}%` }}
        />
      </div>
      <ol className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4" aria-label="Этапы">
        {p.stages.map((s, i) => (
          <li key={s.id} className="relative" aria-current={s.status === 'current' ? 'step' : undefined}>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold',
                  s.status === 'done' && 'bg-ok text-white',
                  s.status === 'current' && 'bg-brand text-white ring-4 ring-brand/15',
                  s.status === 'upcoming' && 'bg-canvas text-ink-muted',
                )}
              >
                {s.status === 'done' ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> : i + 1}
              </span>
              <span
                className={cn(
                  'text-sm font-semibold leading-tight',
                  s.status === 'upcoming' && 'text-ink-muted',
                )}
              >
                {s.title}
              </span>
            </div>
            <p className="mt-1 pl-9 text-xs text-ink-muted">
              {s.done}/{s.total}
              <span className="sr-only">
                {' '}
                — {s.status === 'done' ? 'пройден' : s.status === 'current' ? 'текущий этап' : 'впереди'}
              </span>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
