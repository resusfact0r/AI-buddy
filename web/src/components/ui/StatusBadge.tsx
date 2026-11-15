import type { LucideIcon } from 'lucide-react';
import { Badge, type Tone } from './Badge';

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

/** Бейдж статуса: цвет + иконка + текст (цвет не единственный носитель смысла). */
export function StatusBadge({ meta }: { meta: StatusMeta }) {
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {meta.label}
    </Badge>
  );
}

export function RequiredBadge({ required }: { required: boolean }) {
  return <Badge tone={required ? 'violet' : 'neutral'}>{required ? 'обязательная' : 'по желанию'}</Badge>;
}
