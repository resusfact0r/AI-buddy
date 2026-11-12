import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
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
    <section className="card flex items-center gap-4 p-5" aria-labelledby="access-widget-title">
      <span
        className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-soft text-violet"
        aria-hidden
      >
        <KeyRound className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="access-widget-title" className="font-bold">
          Мои доступы
        </h2>
        <p className="text-sm text-ink-soft">
          Выдано{' '}
          <b className="text-ink">
            {granted} из {total}
          </b>
          {requested > 0 && <> · запрошено {requested}</>}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden>
          <div
            className="h-full rounded-full bg-violet transition-[width] duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <Link
        to="/access"
        className="shrink-0 rounded-xl bg-canvas px-3 py-2 text-sm font-semibold hover:bg-line"
        aria-label="Открыть экран «Мои доступы»"
      >
        Открыть
      </Link>
    </section>
  );
}
