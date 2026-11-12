import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/api/backend';
import { qk } from '@/api/queryKeys';
import type { AccessForm } from '@/api/schemas';

export const useAccessOverview = () =>
  useQuery({ queryKey: qk.accessOverview, queryFn: backendApi.accessOverview });

export function useRequestAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ values, idempotencyKey }: { values: AccessForm; idempotencyKey: string }) =>
      backendApi.createAccess(values, idempotencyKey),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.access });
      void qc.invalidateQueries({ queryKey: qk.requests });
    },
  });
}
