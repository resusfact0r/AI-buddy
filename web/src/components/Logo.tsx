export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-12 w-12 rounded-2xl' : 'h-9 w-9 rounded-xl';
  return (
    <span className="flex items-center gap-2.5">
      <span className={`grid ${box} place-items-center bg-brand text-white shadow-sm`} aria-hidden>
        <svg viewBox="0 0 32 32" className="h-3/4 w-3/4">
          <circle cx="11.5" cy="14" r="2.6" fill="currentColor" />
          <circle cx="20.5" cy="14" r="2.6" fill="currentColor" />
          <path
            d="M11 20.5c2.8 2.4 7.2 2.4 10 0"
            stroke="currentColor"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span
        className={
          size === 'lg' ? 'text-2xl font-extrabold tracking-tight' : 'text-lg font-extrabold tracking-tight'
        }
      >
        AI-buddy
      </span>
    </span>
  );
}
