import { cn } from '@/lib/cn';

const palette = [
  'bg-brand-soft text-brand-strong',
  'bg-violet-soft text-violet',
  'bg-ok-soft text-ok',
  'bg-warn-soft text-warn',
];

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  const color = palette[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % palette.length];
  return (
    <span
      aria-hidden
      className={cn(
        'grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold',
        color,
        className,
      )}
    >
      {initials}
    </span>
  );
}
