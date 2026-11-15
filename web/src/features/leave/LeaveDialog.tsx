import { toast } from 'sonner';
import { FormDialog } from '@/components/FormDialog';
import { useCreateLeave } from '@/features/requests/hooks';
import { LeaveForm } from './LeaveForm';

export function LeaveDialog({ onClose }: { onClose: () => void }) {
  const m = useCreateLeave();
  return (
    <FormDialog
      title="Оформить отгул"
      description="Заявка уйдёт руководителю на согласование."
      error={m.error}
      onClose={onClose}
    >
      {({ idempotencyKey, serverErrors, onError }) => (
        <LeaveForm
          pending={m.isPending}
          serverErrors={serverErrors}
          onCancel={onClose}
          onSubmit={(values) =>
            m.mutate(
              { values, idempotencyKey },
              {
                onSuccess: (r) => {
                  toast.success(`Заявка ${r.number} создана`, {
                    description: 'Отправлена руководителю на согласование.',
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
