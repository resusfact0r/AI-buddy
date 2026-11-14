import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
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
    <section className="card p-6 sm:p-7" aria-labelledby="progress-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="progress-title" className="text-2xl font-extrabold">
          Прогресс адаптации
        </h2>
        <Link
          to="/plan"
          className="flex items-center gap-1 text-sm font-bold text-ink underline-offset-4 hover:underline"
        >
          Весь план <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <div className="mt-4 flex items-end gap-3">
        <span className="text-[64px] font-extrabold leading-none tracking-tighter tabular-nums">
          {p.percent}%
        </span>
        <span className="pb-2 text-[15px] font-medium text-ink-soft">
          {p.done_tasks} из {p.total_tasks} обязательных задач
        </span>
      </div>
      <div
        className="mt-4 h-3 overflow-hidden rounded-full bg-canvas"
        role="progressbar"
        aria-valuenow={p.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Общий прогресс"
      >
        <div
          className="h-full rounded-full bg-ok transition-[width] duration-700 ease-out"
          style={{ width: `${p.percent}%` }}
        />
      </div>
      <ol className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Этапы">
        {p.stages.map((s, i) => (
          <li
            key={s.id}
            aria-current={s.status === 'current' ? 'step' : undefined}
            className={cn(
              'rounded-2xl p-3.5',
              s.status === 'done' && 'bg-ok-soft',
              s.status === 'current' && 'bg-brand text-ink',
              s.status === 'upcoming' && 'bg-canvas text-ink-soft',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold tabular-nums">
                {s.status === 'done' ? (
                  <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
                ) : (
                  `0${i + 1}`
                )}
              </span>
              <span className="text-xs font-bold tabular-nums">
                {s.done}/{s.total}
              </span>
            </div>
            <p className="mt-3 text-sm font-bold leading-tight">{s.title}</p>
            <span className="sr-only">
              {' '}
              — {s.status === 'done' ? 'пройден' : s.status === 'current' ? 'текущий этап' : 'впереди'}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
