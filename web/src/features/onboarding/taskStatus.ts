import type { TaskStatus } from '@/api/schemas';
import type { Tone } from '@/components/ui/Badge';

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  todo: { label: 'Не начата', tone: 'neutral' },
  in_progress: { label: 'В работе', tone: 'brand' },
  done: { label: 'Выполнена', tone: 'ok' },
};

export const AUTO_TASK_HINT = 'Закроется автоматически, когда будут выданы все доступы';
