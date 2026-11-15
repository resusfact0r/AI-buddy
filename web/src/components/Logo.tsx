import { Buddy } from './Buddy';

/** Логотип продукта: маскот Бадди и название. На экране входа (lg) Бадди «живой». */
export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <span className="flex items-center gap-2.5">
      <Buddy compact still={!lg} size={lg ? 48 : 36} />
      <span
        className={lg ? 'text-2xl font-extrabold tracking-tight' : 'text-lg font-extrabold tracking-tight'}
      >
        AI-buddy
      </span>
    </span>
  );
}
