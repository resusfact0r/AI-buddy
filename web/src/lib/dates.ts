/** Даты без часовых поясов: работаем с ISO-строками YYYY-MM-DD как с «календарными» днями. */

function parse(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, n: number): string {
  const d = parse(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const weekdayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** «пт, 13 ноября» */
export function formatDay(iso: string): string {
  const d = parse(iso);
  return `${weekdayFmt.format(d)}, ${dayFmt.format(d)}`;
}

/** «пт, 13 ноября» или «пн, 16 — ср, 18 ноября» */
export function formatRange(from: string, to: string): string {
  if (from === to) return formatDay(from);
  return `${formatDay(from)} — ${formatDay(to)}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTimeFmt.format(d);
}

/** Ближайший будущий день недели (0 — вс, 5 — пт). Если сегодня этот день — через неделю. */
export function nextWeekday(fromIso: string, weekday: number): string {
  const d = parse(fromIso);
  const diff = (weekday - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return toIso(d);
}

export function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} дня`;
  return `${n} дней`;
}
