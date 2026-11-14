import { useState } from 'react';
import { CheckCircle2, Clock3, KeyRound, Plus, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { AccessStatus, AccessSystem } from '@/api/schemas';
import { toApiError } from '@/api/errors';
import { newIdempotencyKey } from '@/api/http';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { AccessRequestForm } from '@/features/access/AccessRequestForm';
import { useAccessOverview, useRequestAccess } from '@/features/access/hooks';
import { notifyError } from '@/lib/toast';

const STATUS: Record<AccessStatus, { label: string; tone: Tone; icon: typeof Clock3 }> = {
  granted: { label: 'Есть', tone: 'ok', icon: CheckCircle2 },
  requested: { label: 'Запрошен', tone: 'warn', icon: Clock3 },
  missing: { label: 'Не хватает', tone: 'danger', icon: XCircle },
};

function StatusBadge({ status }: { status: AccessStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone}>
      <s.icon className="h-3.5 w-3.5" aria-hidden />
      {s.label}
    </Badge>
  );
}

function RequestDialog({ systems, onClose }: { systems: AccessSystem[]; onClose: () => void }) {
  const m = useRequestAccess();
  const [key] = useState(newIdempotencyKey);
  const err = m.error ? toApiError(m.error) : null;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Запрос доступа"
      description="Запрос уйдёт руководителю на согласование."
    >
      {err && err.kind !== 'validation' && (
        <p role="alert" className="mb-3 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger-strong">
          {err.message}
        </p>
      )}
      <AccessRequestForm
        systems={systems}
        pending={m.isPending}
        serverErrors={err?.fieldErrors}
        submitLabel="Запросить"
        onCancel={onClose}
        onSubmit={(values) =>
          m.mutate(
            { values, idempotencyKey: key },
            {
              onSuccess: (res) => {
                toast.success(`Запрос отправлен: ${res.requests.map((r) => r.number).join(', ')}`, {
                  description: 'Статус можно отслеживать в «Моих заявках».',
                });
                onClose();
              },
              onError: (e) => {
                const ae = toApiError(e);
                if (ae.kind === 'upstream' || ae.kind === 'network' || ae.kind === 'timeout') notifyError(e);
              },
            },
          )
        }
      />
    </Modal>
  );
}

export function AccessPage() {
  const q = useAccessOverview();
  const [dialog, setDialog] = useState<AccessSystem[] | null>(null);
  const missing = q.data?.systems.filter((s) => s.status === 'missing') ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Мои доступы</h1>
          {q.data && (
            <p className="mt-1 max-w-2xl text-lg font-medium text-ink-soft">
              Выдано{' '}
              <b className="text-ink">
                {q.data.granted} из {q.data.total}
              </b>
              . Запрос согласует руководитель; когда выданы все обязательные, задача «Получить доступы»
              закроется сама.
            </p>
          )}
        </div>
        {missing.length > 1 && (
          <Button onClick={() => setDialog(missing)}>
            <Plus className="h-4 w-4" aria-hidden /> Запросить все недостающие
          </Button>
        )}
      </div>

      {q.isPending ? (
        <SkeletonCard lines={5} />
      ) : q.isError ? (
        <div className="card">
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-left text-[15px]">
            <caption className="sr-only">Системы и статус доступа</caption>
            <thead className="hidden border-b border-line text-xs font-bold uppercase tracking-[0.08em] text-ink-soft sm:table-header-group">
              <tr>
                <th scope="col" className="px-5 py-3">
                  Система
                </th>
                <th scope="col" className="px-3 py-3">
                  Обязательная
                </th>
                <th scope="col" className="px-3 py-3">
                  Статус
                </th>
                <th scope="col" className="px-5 py-3 text-right">
                  <span className="sr-only">Действие</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.systems.map((s) => (
                <tr
                  key={s.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4 sm:table-row sm:p-0"
                >
                  <td className="w-full sm:w-auto sm:px-5 sm:py-4">
                    <div className="flex items-center gap-3">
                      <span
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-soft text-ink"
                        aria-hidden
                      >
                        <KeyRound className="h-4 w-4" />
                      </span>
                      <div>
                        <div className="text-[17px] font-bold">{s.name}</div>
                        <div className="text-sm text-ink-soft">{s.purpose}</div>
                      </div>
                    </div>
                  </td>
                  <td className="sm:px-3 sm:py-4">
                    <Badge tone={s.required ? 'violet' : 'neutral'}>
                      {s.required ? 'обязательная' : 'по желанию'}
                    </Badge>
                  </td>
                  <td className="sm:px-3 sm:py-4">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="ml-auto sm:px-5 sm:py-4 sm:text-right">
                    {s.status === 'missing' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDialog([s])}
                        aria-label={`Запросить доступ к ${s.name}`}
                      >
                        Запросить
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog && <RequestDialog systems={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
