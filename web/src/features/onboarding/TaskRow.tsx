import { Link, useNavigate } from 'react-router-dom';
import { Check, Lock, MessageCircle, Play } from 'lucide-react';
import type { Task } from '@/api/schemas';
import { askBuddy } from '@/stores/chat';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { RequiredBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/cn';
import { useUpdateTask } from './hooks';
import { AUTO_TASK_HINT, TASK_STATUS } from './taskStatus';

export function TaskRow({ task }: { task: Task }) {
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
    <li className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-start">
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
            'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2',
            done ? 'border-ok bg-ok text-white' : 'border-line bg-white',
            locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-ok',
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
          <p className={cn('font-semibold leading-snug', done && 'text-ink-soft line-through')}>
            {task.title}
          </p>
          {task.description && <p className="mt-0.5 text-sm text-ink-soft">{task.description}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={st.tone}>{st.label}</Badge>
            <RequiredBadge required={task.required} />
          </div>
          {locked && (
            <p
              id={`${checkboxId}-lock`}
              className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-ink-muted"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden />
              {AUTO_TASK_HINT}.
              <Link to="/access" className="font-semibold text-brand hover:underline">
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
          <MessageCircle className="h-4 w-4 text-brand" aria-hidden /> Спросить AI-buddy
        </Button>
      </div>
    </li>
  );
}
