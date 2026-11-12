import { LEAVE_TYPE_LABEL, type WorkRequest } from '@/api/schemas';
import { formatRange } from '@/lib/dates';

export function requestTitle(r: WorkRequest): string {
  return r.type === 'leave' ? LEAVE_TYPE_LABEL[r.leave.leave_type] : `Доступ: ${r.access.system_name}`;
}

export function requestSubject(r: WorkRequest): string {
  return r.type === 'leave' ? formatRange(r.leave.date_from, r.leave.date_to) : r.access.system_name;
}

export function requestReason(r: WorkRequest): string | null {
  return (r.type === 'leave' ? r.leave.comment : r.access.reason) || null;
}
