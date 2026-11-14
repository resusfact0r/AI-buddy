import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/api/backend';
import { qk } from '@/api/queryKeys';
import type { LeaveForm, RequestStatus, RequestType, WorkRequest } from '@/api/schemas';

export const PENDING_REFETCH_MS = 5_000;

export function useRequests(filters: { type: RequestType | ''; status: RequestStatus | '' }) {
  return useQuery({
    queryKey: qk.requestList(filters),
    queryFn: () => backendApi.requests(filters),
    // Пока есть заявки «на согласовании» — опрашиваем, чтобы статус менялся на глазах.
    refetchInterval: (q) =>
      q.state.data?.items.some((r) => r.status === 'pending') ? PENDING_REFETCH_MS : false,
  });
}

export function useRequest(id: string | null) {
  return useQuery({
    queryKey: qk.request(id ?? ''),
    queryFn: () => backendApi.request(id!),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? PENDING_REFETCH_MS : false),
  });
}

export function useCreateLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ values, idempotencyKey }: { values: LeaveForm; idempotencyKey: string }) =>
      backendApi.createLeave(values, idempotencyKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.requests }),
  });
}

export const usePendingApprovals = () =>
  useQuery({ queryKey: qk.approvals, queryFn: backendApi.pendingApprovals, refetchInterval: 10_000 });

/** Одобрить/отклонить с оптимистичным удалением карточки из списка и откатом при ошибке. */
export function useDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      decision,
      comment,
    }: {
      id: string;
      decision: 'approve' | 'reject';
      comment?: string;
    }) => (decision === 'approve' ? backendApi.approve(id, comment) : backendApi.reject(id, comment)),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: qk.approvals });
      const prev = qc.getQueryData<{ items: WorkRequest[] }>(qk.approvals);
      if (prev) qc.setQueryData(qk.approvals, { items: prev.items.filter((r) => r.id !== id) });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.approvals, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.readiness });
      void qc.invalidateQueries({ queryKey: qk.approvals });
      void qc.invalidateQueries({ queryKey: qk.requests });
    },
  });
}
