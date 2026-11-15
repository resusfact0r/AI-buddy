import { CheckCircle2, Clock3, XCircle, AlertTriangle, Ban } from 'lucide-react';
import type { ActionResultStatus, RequestStatus } from '@/api/schemas';
import { StatusBadge, type StatusMeta } from '@/components/ui/StatusBadge';

const REQUEST: Record<RequestStatus, StatusMeta> = {
  failed: { label: 'Ошибка', tone: 'danger', icon: AlertTriangle },
  pending: { label: 'На согласовании', tone: 'warn', icon: Clock3 },
  approved: { label: 'Одобрено', tone: 'ok', icon: CheckCircle2 },
  rejected: { label: 'Отклонено', tone: 'danger', icon: XCircle },
};

const RESULT: Record<ActionResultStatus, StatusMeta> = {
  ...REQUEST,
  done: { label: 'Выполнено', tone: 'ok', icon: CheckCircle2 },
  failed: { label: 'Не выполнено', tone: 'danger', icon: AlertTriangle },
  partial: { label: 'Частично выполнено', tone: 'warn', icon: AlertTriangle },
  cancelled: { label: 'Отменено', tone: 'neutral', icon: Ban },
};

export const RequestStatusBadge = ({ status }: { status: RequestStatus }) => (
  <StatusBadge meta={REQUEST[status]} />
);

export const ActionResultBadge = ({ status }: { status: ActionResultStatus }) => (
  <StatusBadge meta={RESULT[status]} />
);
