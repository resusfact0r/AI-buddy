import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline' | 'accent';
type Size = 'sm' | 'md' | 'lg';

/** Кнопки в стилистике Авито: главная — чёрная, акцентные — яркие плашки с чёрным текстом. */
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink/85 active:bg-ink/75',
  accent: 'bg-brand text-ink hover:brightness-95 active:brightness-90',
  success: 'bg-ok text-ink hover:brightness-95 active:brightness-90',
  secondary: 'bg-canvas text-ink hover:bg-line',
  outline: 'bg-white text-ink ring-1 ring-inset ring-ink/15 hover:bg-canvas hover:ring-ink/30',
  ghost: 'text-ink-soft hover:bg-canvas hover:text-ink',
  danger: 'bg-danger-soft text-ink hover:bg-danger hover:text-white',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm rounded-[10px] gap-1.5',
  md: 'h-11 px-5 text-[15px] rounded-xl gap-2',
  lg: 'h-[52px] px-6 text-base rounded-xl gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-bold transition-[background-color,box-shadow,filter,color] disabled:cursor-not-allowed disabled:opacity-40',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});
