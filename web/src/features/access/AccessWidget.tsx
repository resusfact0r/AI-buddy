import { Link } from 'react-router-dom';
import { ArrowRight, KeyRound } from 'lucide-react';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { useAccessOverview } from './hooks';

export function AccessWidget() {
  const q = useAccessOverview();
  if (q.isPending) return <SkeletonCard lines={1} />;
  if (q.isError) return <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />;
  const { granted, total, systems } = q.data;
  const requested = systems.filter((s) => s.status === 'requested').length;
  const pct = total ? Math.round((granted / total) * 100) : 0;
  return (
    <section className="rounded-3xl bg-violet-soft p-6 sm:p-7" aria-labelledby="access-widget-title">
      <div className="flex items-start gap-4">
        <span
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-ink text-white"
          aria-hidden
        >
          <KeyRound className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="access-widget-title" className="text-2xl font-extrabold">
            Мои доступы
          </h2>
          <p className="mt-0.5 text-[15px] font-medium text-ink/70">
            Выдано{' '}
            <b className="font-extrabold text-ink">
              {granted} из {total}
            </b>
            {requested > 0 && <> · запрошено {requested}</>}
          </p>
        </div>
        <Link
          to="/access"
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-ink px-4 text-[15px] font-bold text-white hover:bg-ink/85"
          aria-label="Открыть экран «Мои доступы»"
        >
          Открыть <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white/70" aria-hidden>
        <div
          className="h-full rounded-full bg-violet transition-[width] duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </section>
  );
}
