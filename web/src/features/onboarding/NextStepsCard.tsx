import { Link } from 'react-router-dom';
import { Check, Lock, Sparkles } from 'lucide-react';
import type { Task } from '@/api/schemas';
import { askBuddy } from '@/stores/chat';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { cn } from '@/lib/cn';
import { useNextSteps, useUpdateTask } from './hooks';
import { AUTO_TASK_HINT } from './taskStatus';

function StepCard({ task, index, onAsk }: { task: Task; index: number; onAsk: (t: Task) => void }) {
  const update = useUpdateTask();
  const done = task.status === 'done';
  return (
    <li
      className={cn(
        'rounded-2xl border p-4 transition-colors',
        done ? 'border-ok/30 bg-ok-soft/50' : 'border-line bg-white',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold',
            done ? 'bg-ok text-white' : 'bg-brand-soft text-brand-strong',
          )}
          aria-hidden
        >
          {done ? <Check className="h-4 w-4" strokeWidth={3} /> : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn('font-semibold leading-snug', done && 'text-ink-soft line-through')}>
            {task.title}
          </p>
          {task.description && <p className="mt-0.5 text-sm text-ink-soft">{task.description}</p>}
          {!task.required && (
            <Badge className="mt-1.5" tone="neutral">
              по желанию
            </Badge>
          )}
          {task.auto_complete && !done && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-muted">
              <Lock className="h-3.5 w-3.5" aria-hidden /> {AUTO_TASK_HINT}.{' '}
              <Link to="/access" className="font-semibold text-brand hover:underline">
                Мои доступы
              </Link>
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 pl-10">
        {!task.auto_complete && (
          <Button
            size="sm"
            variant={done ? 'secondary' : 'success'}
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
        <Button size="sm" variant="outline" onClick={() => onAsk(task)}>
          <Sparkles className="h-4 w-4 text-brand" aria-hidden /> Спросить AI-buddy
        </Button>
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
    <section className="card p-5" aria-labelledby="next-steps-title">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id="next-steps-title" className="text-lg font-bold">
          Следующие шаги
        </h2>
        {q.data.current_stage && (
          <span className="text-sm text-ink-muted">этап «{q.data.current_stage.title}»</span>
        )}
      </div>
      {q.data.steps.length === 0 ? (
        <EmptyState title="Все шаги выполнены 🎉" text="План адаптации пройден. Отличная работа!" />
      ) : (
        <ol className="space-y-2.5">
          {q.data.steps.map((t, i) => (
            <StepCard key={t.id} task={t} index={i} onAsk={ask} />
          ))}
        </ol>
      )}
    </section>
  );
}
