import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { AccessSystem } from '@/api/schemas';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { QueryView } from '@/components/ui/QueryView';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { AccessRequestDialog } from '@/features/access/AccessRequestDialog';
import { AccessTable } from '@/features/access/AccessTable';
import { useAccessOverview } from '@/features/access/hooks';

export function AccessPage() {
  const q = useAccessOverview();
  const [dialog, setDialog] = useState<AccessSystem[] | null>(null);
  const missing = q.data?.systems.filter((s) => s.status === 'missing') ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Мои доступы"
        description={
          q.data && (
            <>
              Выдано{' '}
              <b className="text-ink">
                {q.data.granted} из {q.data.total}
              </b>
              . Запрос согласует руководитель; когда выданы все обязательные, задача «Получить доступы»
              закроется сама.
            </>
          )
        }
        actions={
          missing.length > 1 && (
            <Button onClick={() => setDialog(missing)}>
              <Plus className="h-4 w-4" aria-hidden /> Запросить все недостающие
            </Button>
          )
        }
      />
      <QueryView query={q} loading={<SkeletonCard lines={5} />}>
        {(data) => <AccessTable systems={data.systems} onRequest={(s) => setDialog([s])} />}
      </QueryView>
      {dialog && <AccessRequestDialog systems={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
