import { Link } from 'react-router-dom';
import { Check, Lock, Sparkles } from 'lucide-react';
import type { Task } from '@/api/schemas';
import { askBuddy } from '@/stores/chat';
import { Button } from '@/components/ui/Button';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { cn } from '@/lib/cn';
import { useNextSteps, useUpdateTask } from './hooks';
import { AUTO_TASK_HINT } from './taskStatus';

/** Пастельные плашки шагов — по порядку, как блоки в фирменном шаблоне. */
const TILES = ['bg-ok-soft', 'bg-brand-soft', 'bg-violet-soft'];

function StepCard({ task, index, onAsk }: { task: Task; index: number; onAsk: (t: Task) => void }) {
  const update = useUpdateTask();
  const done = task.status === 'done';
  return (
    <li className={cn('rounded-2xl p-5 transition-colors', done ? 'bg-canvas' : TILES[index % TILES.length])}>
      <div className="flex items-start gap-4">
        <span
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-full text-[15px] font-extrabold',
            done ? 'bg-ok text-ink' : 'bg-ink text-white',
          )}
          aria-hidden
        >
          {done ? <Check className="h-5 w-5" strokeWidth={3} /> : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn('text-lg font-bold leading-snug', done && 'text-ink-soft line-through')}>
            {task.title}
          </p>
          {task.description && <p className="mt-1 text-[15px] text-ink/70">{task.description}</p>}
          {!task.required && (
            <span className="mt-2 inline-block rounded-md bg-white/70 px-2 py-0.5 text-xs font-bold">
              по желанию
            </span>
          )}
          {task.auto_complete && !done && (
            <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm text-ink/70">
              <Lock className="h-3.5 w-3.5" aria-hidden /> {AUTO_TASK_HINT}.{' '}
              <Link to="/access" className="font-bold text-ink underline underline-offset-2">
                Мои доступы
              </Link>
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {!task.auto_complete && (
              <Button
                size="sm"
                variant={done ? 'outline' : 'primary'}
                onClick={() => update.mutate({ taskId: task.id, status: done ? 'todo' : 'done' })}
                aria-label={
                  done ? `Вернуть задачу «${task.title}» в работу` : `Отметить «${task.title}» выполненной`
                }
              >
                {done ? (
                  'Вернуть'
                ) : (
                  <>
                    <Check className="h-4 w-4" aria-hidden /> Готово
                  </>
                )}
              </Button>
            )}
            <Button size="sm" variant="outline" className="ring-0" onClick={() => onAsk(task)}>
              <Sparkles className="h-4 w-4" aria-hidden /> Спросить AI-buddy
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

export function NextStepsCard({ onAsk }: { onAsk?: () => void }) {
  const q = useNextSteps();
  if (q.isPending) return <SkeletonCard lines={4} />;
  if (q.isError) return <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />;
  const ask = (t: Task) => {
    askBuddy(`Помоги с задачей «${t.title}»: с чего начать?`);
    onAsk?.();
  };
  return (
    <section className="card p-6 sm:p-7" aria-labelledby="next-steps-title">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="next-steps-title" className="text-2xl font-extrabold">
          Следующие шаги
        </h2>
        {q.data.current_stage && (
          <span className="text-sm font-medium text-ink-soft">этап «{q.data.current_stage.title}»</span>
        )}
      </div>
      {q.data.steps.length === 0 ? (
        <EmptyState title="Все шаги выполнены 🎉" text="План адаптации пройден. Отличная работа!" />
      ) : (
        <ol className="space-y-3">
          {q.data.steps.map((t, i) => (
            <StepCard key={t.id} task={t} index={i} onAsk={ask} />
          ))}
        </ol>
      )}
    </section>
  );
}
