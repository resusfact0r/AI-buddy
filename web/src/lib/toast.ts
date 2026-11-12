import { toast } from 'sonner';
import { toApiError } from '@/api/errors';

/** Единая реакция на ошибки мутаций: текст + «Повторить» для временных сбоев. */
export function notifyError(error: unknown, retry?: () => void): void {
  const e = toApiError(error);
  if (e.kind === 'unauthorized') return; // уже разлогинили и отправили на вход
  if (e.retryable && retry) {
    toast.error(e.message, { action: { label: 'Повторить', onClick: retry }, duration: 8000 });
  } else {
    toast.error(e.message);
  }
}

export { toast };
