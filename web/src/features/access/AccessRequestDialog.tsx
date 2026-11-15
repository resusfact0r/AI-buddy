import { toast } from 'sonner';
import type { AccessSystem } from '@/api/schemas';
import { FormDialog } from '@/components/FormDialog';
import { AccessRequestForm } from './AccessRequestForm';
import { useRequestAccess } from './hooks';

export function AccessRequestDialog({ systems, onClose }: { systems: AccessSystem[]; onClose: () => void }) {
  const m = useRequestAccess();
  return (
    <FormDialog
      title="Запрос доступа"
      description="Запрос уйдёт руководителю на согласование."
      error={m.error}
      onClose={onClose}
    >
      {({ idempotencyKey, serverErrors, onError }) => (
        <AccessRequestForm
          systems={systems}
          pending={m.isPending}
          serverErrors={serverErrors}
          submitLabel="Запросить"
          onCancel={onClose}
          onSubmit={(values) =>
            m.mutate(
              { values, idempotencyKey },
              {
                onSuccess: (res) => {
                  toast.success(`Запрос отправлен: ${res.requests.map((r) => r.number).join(', ')}`, {
                    description: 'Статус можно отслеживать в «Моих заявках».',
                  });
                  onClose();
                },
                onError,
              },
            )
          }
        />
      )}
    </FormDialog>
  );
}
