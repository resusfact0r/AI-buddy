import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Плашка ошибки внутри формы/карточки; справа — необязательное действие. */
export function InlineAlert({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'mb-3 flex items-center gap-3 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger',
        className,
      )}
    >
      <span className="flex-1">{children}</span>
      {action}
    </div>
  );
}
