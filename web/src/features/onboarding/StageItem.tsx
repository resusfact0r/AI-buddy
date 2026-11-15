import * as Accordion from '@radix-ui/react-accordion';
import { Check, ChevronDown } from 'lucide-react';
import type { Stage } from '@/api/schemas';
import { cn } from '@/lib/cn';
import { TaskRow } from './TaskRow';

export function StageItem({
  stage,
  index,
  onlyRequired,
}: {
  stage: Stage;
  index: number;
  onlyRequired: boolean;
}) {
  const tasks = onlyRequired ? stage.tasks.filter((t) => t.required) : stage.tasks;
  const required = stage.tasks.filter((t) => t.required);
  const done = required.filter((t) => t.status === 'done').length;
  const complete = done === required.length;
  return (
    <Accordion.Item value={stage.id} className="card overflow-hidden">
      <Accordion.Header>
        <Accordion.Trigger className="group flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-canvas/50">
          <span
            className={cn(
              'grid h-9 w-9 shrink-0 place-items-center rounded-xl font-bold',
              complete ? 'bg-ok text-white' : 'bg-brand-soft text-brand-strong',
            )}
            aria-hidden
          >
            {complete ? <Check className="h-5 w-5" strokeWidth={3} /> : index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-bold leading-tight">{stage.title}</span>
            {stage.description && <span className="block text-sm text-ink-soft">{stage.description}</span>}
          </span>
          <span className="text-sm font-semibold tabular-nums text-ink-soft">
            {done}/{required.length}
          </span>
          <ChevronDown
            className="h-5 w-5 text-ink-muted transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content className="border-t border-line px-5">
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
