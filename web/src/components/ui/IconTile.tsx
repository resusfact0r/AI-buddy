import type { LucideIcon } from 'lucide-react';
import type { Tone } from './Badge';
import { cn } from '@/lib/cn';

const tones: Record<Tone, string> = {
  neutral: 'bg-canvas text-ink-muted',
  brand: 'bg-brand-soft text-brand',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  violet: 'bg-violet-soft text-violet',
};

type Size = 'xs' | 'sm' | 'md' | 'lg';

const sizes: Record<Size, { box: string; icon: string }> = {
  xs: { box: 'h-7 w-7 rounded-lg', icon: 'h-4 w-4' },
  sm: { box: 'h-8 w-8 rounded-lg', icon: 'h-4 w-4' },
  md: { box: 'h-9 w-9 rounded-xl', icon: 'h-4 w-4' },
  lg: { box: 'h-10 w-10 rounded-xl', icon: 'h-5 w-5' },
};

/** Декоративная плитка с иконкой на мягком фоне тона. */
export function IconTile({
  icon: Icon,
  tone = 'brand',
  size = 'md',
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  size?: Size;
  className?: string;
}) {
  const s = sizes[size];
  return (
    <span className={cn('grid shrink-0 place-items-center', s.box, tones[tone], className)} aria-hidden>
      <Icon className={s.icon} />
    </span>
  );
}
