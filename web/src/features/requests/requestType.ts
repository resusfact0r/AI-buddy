import { CalendarDays, KeyRound, type LucideIcon } from 'lucide-react';
import type { RequestType } from '@/api/schemas';
import type { Tone } from '@/components/ui/Badge';

/** Иконка и тон по типу заявки — один источник для списков, согласований и карточек в чате. */
export const REQUEST_TYPE_META: Record<RequestType, { label: string; icon: LucideIcon; tone: Tone }> = {
  leave: { label: 'Отгулы', icon: CalendarDays, tone: 'brand' },
  access: { label: 'Доступы', icon: KeyRound, tone: 'violet' },
};
