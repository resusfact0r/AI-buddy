/** Знак AI-buddy: чёрный квадрат с зелёной улыбкой. Логотипы Авито не используются. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={`grid place-items-center bg-ink text-ok ${className ?? 'h-9 w-9 rounded-xl'}`}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" className="h-3/4 w-3/4">
        <circle cx="11.5" cy="13.5" r="2.7" fill="currentColor" />
        <circle cx="20.5" cy="13.5" r="2.7" fill="currentColor" />
        <path
          d="M10.5 20c3 2.8 8 2.8 11 0"
          stroke="currentColor"
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className={size === 'lg' ? 'h-12 w-12 rounded-2xl' : 'h-9 w-9 rounded-xl'} />
      <span className={size === 'lg' ? 'page-title' : 'text-xl font-extrabold tracking-tight'}>AI-buddy</span>
    </span>
  );
}
