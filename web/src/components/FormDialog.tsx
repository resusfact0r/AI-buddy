import { useState, type ReactNode } from 'react';
import { toApiError } from '@/api/errors';
import { newIdempotencyKey } from '@/api/http';
import { Modal } from '@/components/ui/Modal';
import { InlineAlert } from '@/components/ui/InlineAlert';
import type { FieldErrors } from '@/lib/zodForm';
import { notifyError } from '@/lib/toast';

export interface FormDialogRenderProps {
  /** Ключ идемпотентности — один на всё время жизни диалога (повторы не создают дубликатов). */
  idempotencyKey: string;
  /** Ошибки по полям из ответа сервера (validation_error). */
  serverErrors?: FieldErrors;
  /** Обработчик ошибки мутации: тост только для временных сбоев, остальное видно в диалоге. */
  onError: (error: unknown) => void;
}

/**
 * Модалка с формой, отправляющей мутацию: общая плашка серверной ошибки (кроме ошибок по полям),
 * ключ идемпотентности и единое правило тостов.
 */
export function FormDialog({
  title,
  description,
  error,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  error: unknown;
  onClose: () => void;
  children: (p: FormDialogRenderProps) => ReactNode;
}) {
  const [idempotencyKey] = useState(newIdempotencyKey);
  const err = error ? toApiError(error) : null;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} description={description}>
      {err && err.kind !== 'validation' && <InlineAlert>{err.message}</InlineAlert>}
      {children({
        idempotencyKey,
        serverErrors: err?.fieldErrors,
        onError: (e) => {
          if (toApiError(e).retryable) notifyError(e);
        },
      })}
    </Modal>
  );
}
