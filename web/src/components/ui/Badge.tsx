import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' | 'violet';

/** Пастельная плашка с чёрным текстом — как блоки в фирменном шаблоне. */
const tones: Record<Tone, string> = {
  neutral: 'bg-canvas text-ink-soft',
  brand: 'bg-brand-soft text-ink',
  ok: 'bg-ok-soft text-ink',
  warn: 'bg-warn-soft text-ink',
  danger: 'bg-danger-soft text-ink',
  violet: 'bg-violet-soft text-ink',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-bold',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
