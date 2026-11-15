import { ChevronRight } from 'lucide-react';
import type { WorkRequest } from '@/api/schemas';
import { IconTile } from '@/components/ui/IconTile';
import { formatDateTime } from '@/lib/dates';
import { RequestStatusBadge } from './status';
import { requestSubject, requestTitle } from './describe';
import { REQUEST_TYPE_META } from './requestType';

export function RequestRow({ r, onOpen }: { r: WorkRequest; onOpen: () => void }) {
  const meta = REQUEST_TYPE_META[r.type];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-canvas/60"
      >
        <IconTile icon={meta.icon} tone={meta.tone} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{requestTitle(r)}</span>
          <span className="block text-sm text-ink-soft">
            {r.type === 'leave' ? requestSubject(r) : (r.access.reason ?? '')}
          </span>
        </span>
        <span className="hidden text-right text-xs text-ink-muted sm:block">
          {r.number}
          <br />
          {formatDateTime(r.created_at)}
        </span>
        <RequestStatusBadge status={r.status} />
        <ChevronRight className="h-4 w-4 text-ink-muted" aria-hidden />
      </button>
    </li>
  );
}
