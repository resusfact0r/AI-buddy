import { CheckCircle2, Clock3, XCircle, AlertTriangle, Ban } from 'lucide-react';
import type { ActionResultStatus, RequestStatus } from '@/api/schemas';
import { Badge, type Tone } from '@/components/ui/Badge';

const REQUEST: Record<RequestStatus, { label: string; tone: Tone; icon: typeof Clock3 }> = {
  failed: { label: 'Ошибка', tone: 'danger', icon: AlertTriangle },
  pending: { label: 'На согласовании', tone: 'warn', icon: Clock3 },
  approved: { label: 'Одобрено', tone: 'ok', icon: CheckCircle2 },
  rejected: { label: 'Отклонено', tone: 'danger', icon: XCircle },
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const s = REQUEST[status];
  return (
    <Badge tone={s.tone}>
      <s.icon className="h-3.5 w-3.5" aria-hidden />
      {s.label}
    </Badge>
  );
}

const RESULT: Record<ActionResultStatus, { label: string; tone: Tone; icon: typeof Clock3 }> = {
  ...REQUEST,
  done: { label: 'Выполнено', tone: 'ok', icon: CheckCircle2 },
  failed: { label: 'Не выполнено', tone: 'danger', icon: AlertTriangle },
  partial: { label: 'Частично выполнено', tone: 'warn', icon: AlertTriangle },
  cancelled: { label: 'Отменено', tone: 'neutral', icon: Ban },
};

export function ActionResultBadge({ status }: { status: ActionResultStatus }) {
  const s = RESULT[status];
  return (
    <Badge tone={s.tone}>
      <s.icon className="h-3.5 w-3.5" aria-hidden />
      {s.label}
    </Badge>
  );
}
