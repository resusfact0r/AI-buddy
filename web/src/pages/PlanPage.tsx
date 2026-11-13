import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as Accordion from '@radix-ui/react-accordion';
import { Check, ChevronDown, Lock, Play, Sparkles } from 'lucide-react';
import type { Stage, Task } from '@/api/schemas';
import { askBuddy } from '@/stores/chat';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { cn } from '@/lib/cn';
import { usePlan, useProgress, useUpdateTask } from '@/features/onboarding/hooks';
import { AUTO_TASK_HINT, TASK_STATUS } from '@/features/onboarding/taskStatus';

function TaskRow({ task }: { task: Task }) {
  const update = useUpdateTask();
  const navigate = useNavigate();
  const done = task.status === 'done';
  const locked = task.auto_complete;
  const st = TASK_STATUS[task.status];
  const checkboxId = `task-${task.id}`;

  const ask = () => {
    askBuddy(`Расскажи про задачу «${task.title}»: что нужно сделать и к кому обратиться?`);
    navigate('/chat');
  };

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <input
          id={checkboxId}
          type="checkbox"
          className="peer sr-only"
          checked={done}
          disabled={locked}
          onChange={() => update.mutate({ taskId: task.id, status: done ? 'todo' : 'done' })}
          aria-describedby={locked ? `${checkboxId}-lock` : undefined}
        />
        <label
          htmlFor={checkboxId}
          className={cn(
            'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ink peer-focus-visible:ring-offset-2',
            done ? 'border-ok bg-ok text-ink' : 'border-ink/25 bg-white',
            locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-ink',
          )}
        >
          {done ? (
            <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
          ) : locked ? (
            <Lock className="h-3 w-3 text-ink-muted" aria-hidden />
          ) : null}
          <span className="sr-only">
            {done ? 'Выполнена' : 'Отметить выполненной'}: {task.title}
          </span>
        </label>
        <div className="min-w-0">
          <p className={cn('text-[17px] font-bold leading-snug', done && 'text-ink-soft line-through')}>
            {task.title}
          </p>
          {task.description && <p className="mt-0.5 text-sm text-ink-soft">{task.description}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={st.tone}>{st.label}</Badge>
            <Badge tone={task.required ? 'violet' : 'neutral'}>
              {task.required ? 'обязательная' : 'по желанию'}
            </Badge>
          </div>
          {locked && (
            <p
              id={`${checkboxId}-lock`}
              className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-ink-muted"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden />
              {AUTO_TASK_HINT}.
              <Link to="/access" className="font-bold text-ink underline underline-offset-2">
                Мои доступы →
              </Link>
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2 pl-9 sm:pl-0">
        {task.status === 'todo' && !locked && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => update.mutate({ taskId: task.id, status: 'in_progress' })}
          >
            <Play className="h-3.5 w-3.5" aria-hidden /> В работу
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={ask}
          aria-label={`Спросить AI-buddy про задачу «${task.title}»`}
        >
          <Sparkles className="h-4 w-4" aria-hidden /> Спросить AI-buddy
        </Button>
      </div>
    </li>
  );
}

function StageItem({ stage, index, onlyRequired }: { stage: Stage; index: number; onlyRequired: boolean }) {
  const tasks = onlyRequired ? stage.tasks.filter((t) => t.required) : stage.tasks;
  const required = stage.tasks.filter((t) => t.required);
  const done = required.filter((t) => t.status === 'done').length;
  const complete = done === required.length;
  return (
    <Accordion.Item value={stage.id} className="card overflow-hidden">
      <Accordion.Header>
        <Accordion.Trigger className="group flex w-full items-center gap-4 px-5 py-5 text-left sm:px-6">
          <span
            className={cn(
              'grid h-11 w-11 shrink-0 place-items-center rounded-full text-[15px] font-extrabold',
              complete ? 'bg-ok text-ink' : 'bg-ink text-white',
            )}
            aria-hidden
          >
            {complete ? <Check className="h-5 w-5" strokeWidth={3} /> : index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xl font-extrabold leading-tight">{stage.title}</span>
            {stage.description && <span className="block text-sm text-ink-soft">{stage.description}</span>}
          </span>
          <span className="rounded-md bg-canvas px-2 py-1 text-sm font-bold tabular-nums">
            {done}/{required.length}
          </span>
          <ChevronDown
            className="h-5 w-5 text-ink transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content className="border-t border-line px-5 sm:px-6">
        {tasks.length === 0 ? (
          <p className="py-4 text-sm text-ink-muted">Нет задач по фильтру.</p>
        ) : (
          <ul className="divide-y divide-line">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        )}
      </Accordion.Content>
    </Accordion.Item>
  );
}

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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">План адаптации</h1>
          {progress.data && (
            <p className="mt-1 text-lg font-medium text-ink-soft">
              Выполнено <b className="text-ink">{progress.data.percent}%</b> — {progress.data.done_tasks} из{' '}
              {progress.data.total_tasks} обязательных задач
            </p>
          )}
        </div>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-bold">
          <input
            type="checkbox"
            role="switch"
            className="peer sr-only"
            checked={onlyRequired}
            onChange={(e) => setOnlyRequired(e.target.checked)}
          />
          <span
            aria-hidden
            className="relative h-6 w-10 rounded-full bg-ink/20 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-ink peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-ink peer-focus-visible:ring-offset-2"
          />
          Только обязательные
        </label>
      </div>

      {plan.isPending ? (
        <div className="space-y-3">
          <SkeletonCard lines={1} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={1} />
        </div>
      ) : plan.isError ? (
        <div className="card">
          <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />
        </div>
      ) : (
        <Accordion.Root
          type="multiple"
          value={open ?? defaultOpen}
          onValueChange={setOpen}
          className="space-y-3"
        >
          {plan.data.stages.map((s, i) => (
            <StageItem key={s.id} stage={s} index={i} onlyRequired={onlyRequired} />
          ))}
        </Accordion.Root>
      )}
    </div>
  );
}
