import type { ReactNode } from 'react';

/** Шапка страницы: заголовок и описание слева, действия справа. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-title font-bold">{title}</h1>
        {description && <p className="text-ink-soft">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
