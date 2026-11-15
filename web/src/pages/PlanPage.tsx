import { useMemo, useState } from 'react';
import * as Accordion from '@radix-ui/react-accordion';
import { PageHeader } from '@/components/ui/PageHeader';
import { QueryView } from '@/components/ui/QueryView';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { usePlan, useProgress } from '@/features/onboarding/hooks';
import { StageItem } from '@/features/onboarding/StageItem';

export function PlanPage() {
  const plan = usePlan();
  const progress = useProgress();
  const [onlyRequired, setOnlyRequired] = useState(false);
  const [open, setOpen] = useState<string[] | null>(null);
  const defaultOpen = useMemo(
    () => (progress.data?.current_stage_id ? [progress.data.current_stage_id] : []),
    [progress.data?.current_stage_id],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="План адаптации"
        description={
          progress.data && (
            <>
              Выполнено <b className="text-ink">{progress.data.percent}%</b> — {progress.data.done_tasks} из{' '}
              {progress.data.total_tasks} обязательных задач
            </>
          )
        }
        actions={
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold">
            <input
              type="checkbox"
              role="switch"
              className="peer sr-only"
              checked={onlyRequired}
              onChange={(e) => setOnlyRequired(e.target.checked)}
            />
            <span
              aria-hidden
              className="relative h-6 w-10 rounded-full bg-line transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-brand peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2"
            />
            Только обязательные
          </label>
        }
      />

      <QueryView
        query={plan}
        loading={
          <div className="space-y-3">
            <SkeletonCard lines={1} />
            <SkeletonCard lines={4} />
            <SkeletonCard lines={1} />
          </div>
        }
      >
        {(data) => (
          <Accordion.Root
            type="multiple"
            value={open ?? defaultOpen}
            onValueChange={setOpen}
            className="space-y-3"
          >
            {data.stages.map((s, i) => (
              <StageItem key={s.id} stage={s} index={i} onlyRequired={onlyRequired} />
            ))}
          </Accordion.Root>
        )}
      </QueryView>
    </div>
  );
}
