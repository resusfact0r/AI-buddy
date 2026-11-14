import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, RotateCw } from 'lucide-react';
import { Button } from './Button';
import { toApiError } from '@/api/errors';

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="mb-1 grid h-12 w-12 place-items-center rounded-2xl bg-canvas text-ink">
        <Inbox className="h-6 w-6" aria-hidden />
      </div>
      <p className="text-xl font-extrabold">{title}</p>
      {text && <p className="max-w-sm text-sm text-ink-soft">{text}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const e = toApiError(error);
  return (
    <div
      role="alert"
      className={
        compact
          ? 'flex items-center gap-3 rounded-2xl bg-danger-soft px-4 py-3 text-sm font-semibold text-ink'
          : 'flex flex-col items-center gap-3 px-6 py-10 text-center'
      }
    >
      <AlertTriangle className={compact ? 'h-4 w-4 shrink-0' : 'h-7 w-7 text-danger-strong'} aria-hidden />
      <p className={compact ? 'flex-1' : 'max-w-sm text-ink-soft'}>{e.message}</p>
      {onRetry && (
        <Button size="sm" variant={compact ? 'outline' : 'secondary'} onClick={onRetry}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          Повторить
        </Button>
      )}
    </div>
  );
}
