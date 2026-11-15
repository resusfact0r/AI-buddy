import { CheckCircle2, Clock3, KeyRound, XCircle } from 'lucide-react';
import type { AccessStatus, AccessSystem } from '@/api/schemas';
import { Button } from '@/components/ui/Button';
import { IconTile } from '@/components/ui/IconTile';
import { RequiredBadge, StatusBadge, type StatusMeta } from '@/components/ui/StatusBadge';

const STATUS: Record<AccessStatus, StatusMeta> = {
  granted: { label: 'Есть', tone: 'ok', icon: CheckCircle2 },
  requested: { label: 'Запрошен', tone: 'warn', icon: Clock3 },
  missing: { label: 'Не хватает', tone: 'danger', icon: XCircle },
};

export function AccessTable({
  systems,
  onRequest,
}: {
  systems: AccessSystem[];
  onRequest: (s: AccessSystem) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-left text-body">
        <caption className="sr-only">Системы и статус доступа</caption>
        <thead className="hidden border-b border-line bg-canvas/60 text-xs font-medium text-ink-muted sm:table-header-group">
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
          {systems.map((s) => (
            <tr
              key={s.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4 sm:table-row sm:p-0"
            >
              <td className="w-full sm:w-auto sm:px-5 sm:py-4">
                <div className="flex items-center gap-3">
                  <IconTile icon={KeyRound} tone="violet" />
                  <div>
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-sm text-ink-soft">{s.purpose}</div>
                  </div>
                </div>
              </td>
              <td className="sm:px-3 sm:py-4">
                <RequiredBadge required={s.required} />
              </td>
              <td className="sm:px-3 sm:py-4">
                <StatusBadge meta={STATUS[s.status]} />
              </td>
              <td className="ml-auto sm:px-5 sm:py-4 sm:text-right">
                {s.status === 'missing' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRequest(s)}
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
  );
}
