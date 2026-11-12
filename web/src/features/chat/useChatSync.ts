import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/api/queryKeys';
import { useChat } from '@/stores/chat';

/**
 * После результата действия агента инвалидируем связанные данные —
 * панели слева (план, доступы, заявки, согласования) обновляются сразу.
 */
export function useChatSync(): void {
  const qc = useQueryClient();
  const setOnActionResult = useChat((s) => s.setOnActionResult);
  useEffect(() => {
    setOnActionResult((result) => {
      if (result.status === 'cancelled') return;
      void qc.invalidateQueries({ queryKey: qk.onboarding });
      void qc.invalidateQueries({ queryKey: qk.access });
      void qc.invalidateQueries({ queryKey: qk.requests });
      void qc.invalidateQueries({ queryKey: qk.approvals });
    });
    return () => setOnActionResult(null);
  }, [qc, setOnActionResult]);
}
