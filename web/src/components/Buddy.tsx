import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import './buddy.css';

/** Состояние маскота: простой, ожидание ответа, ответ найден. */
export type BuddyMood = 'idle' | 'thinking' | 'found';

const INK = '#0A0A0A';
const GREEN = '#04E061';
const GREEN_SOFT = '#C9FFBF';
const BLUE = '#00AAFF';
const VIOLET = '#965EEB';
const VIOLET_SOFT = '#DFCDF3';
const RED = '#FF4053';

const stroke = { stroke: INK, strokeWidth: 9, fill: 'none', strokeLinecap: 'round' } as const;

/** Лицо отличается и без анимации — при prefers-reduced-motion состояние всё равно читается. */
function Face({ mood }: { mood: BuddyMood }) {
  if (mood === 'found') {
    return (
      <>
        <path d="M-48 6 Q-34 -16 -20 6" {...stroke} />
        <path d="M20 6 Q34 -16 48 6" {...stroke} />
        <path d="M-30 32 Q0 74 30 32 Z" fill={INK} />
      </>
    );
  }
  if (mood === 'thinking') {
    return (
      <>
        <g className="buddy-eyes">
          <ellipse cx="-28" cy="-8" rx="10" ry="12" fill={INK} />
          <ellipse cx="40" cy="-8" rx="10" ry="12" fill={INK} />
        </g>
        <path d="M-12 44 H18" {...stroke} />
      </>
    );
  }
  return (
    <>
      <g className="buddy-eyes">
        <ellipse cx="-34" cy="0" rx="10" ry="15" fill={INK} />
        <ellipse cx="34" cy="0" rx="10" ry="15" fill={INK} />
      </g>
      <path d="M-30 38 Q0 66 30 38" {...stroke} />
    </>
  );
}

interface BuddyProps {
  mood?: BuddyMood;
  /** Сторона квадрата в пикселях. */
  size?: number;
  /** Только сам стикер, без подложки и «руки» — для мелких аватаров. */
  compact?: boolean;
  /** Не запускать циклическую анимацию простоя (например, у старых сообщений). */
  still?: boolean;
  /** Если задано, маскот озвучивается как изображение; иначе он декоративный. */
  label?: string;
  className?: string;
}

/** Бадди — маскот AI-buddy: зелёный стикер с загнутым уголком. */
export function Buddy({
  mood = 'idle',
  size = 40,
  compact = false,
  still = false,
  label,
  className,
}: BuddyProps) {
  return (
    <svg
      className={cn('buddy shrink-0', className)}
      data-mood={mood}
      data-still={still ? '' : undefined}
      width={size}
      height={size}
      viewBox={compact ? '64 64 272 272' : '0 0 400 400'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {!compact && (
        <g transform="rotate(9 200 204)">
          <rect x="92" y="96" width="228" height="228" fill={VIOLET_SOFT} />
        </g>
      )}

      {!compact && mood === 'thinking' && (
        <g>
          <rect className="buddy-dot" x="146" y="22" width="24" height="24" fill={BLUE} />
          <rect className="buddy-dot" x="188" y="22" width="24" height="24" fill={VIOLET} />
          <rect className="buddy-dot" x="230" y="22" width="24" height="24" fill={RED} />
        </g>
      )}

      {!compact && mood === 'found' && (
        <g>
          <rect
            className="buddy-spark"
            style={{ '--buddy-dx': '110px', '--buddy-dy': '120px' } as CSSProperties}
            x="44"
            y="40"
            width="28"
            height="28"
            fill={RED}
            transform="rotate(-14 58 54)"
          />
          <rect
            className="buddy-spark"
            style={{ '--buddy-dx': '130px', '--buddy-dy': '-90px' } as CSSProperties}
            x="26"
            y="282"
            width="24"
            height="24"
            fill={VIOLET}
            transform="rotate(12 38 294)"
          />
        </g>
      )}

      <g className="buddy-body">
        <g transform="rotate(-6 200 200)">
          <path d="M84 84 H316 V262 L262 316 H84 Z" fill={GREEN} />
          <path d="M316 262 H262 V316 Z" fill={GREEN_SOFT} />
          <g transform="translate(200 186)">
            <Face mood={mood} />
          </g>
        </g>
      </g>

      {!compact && (
        <g className="buddy-hand">
          {mood === 'found' ? (
            <g transform="rotate(18 347 117)">
              <rect x="314" y="84" width="66" height="66" fill={BLUE} />
              <path
                className="buddy-check"
                d="M331 118 l11 11 l20 -23"
                stroke="#FFFFFF"
                strokeWidth="8"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ) : (
            <rect x="322" y="92" width="50" height="50" fill={BLUE} transform="rotate(18 347 117)" />
          )}
        </g>
      )}
    </svg>
  );
}
