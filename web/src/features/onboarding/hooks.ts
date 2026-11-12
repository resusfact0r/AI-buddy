import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/api/backend';
import { qk } from '@/api/queryKeys';
import type { NextSteps, Plan, TaskStatus } from '@/api/schemas';
import { notifyError } from '@/lib/toast';

export const useProfile = () =>
  useQuery({ queryKey: qk.profile, queryFn: backendApi.profile, staleTime: 5 * 60_000 });
export const usePlan = () => useQuery({ queryKey: qk.plan, queryFn: backendApi.plan });
export const useProgress = () => useQuery({ queryKey: qk.progress, queryFn: backendApi.progress });
export const useNextSteps = () => useQuery({ queryKey: qk.nextSteps, queryFn: backendApi.nextSteps });

type Vars = { taskId: string; status: TaskStatus };

/**
 * Смена статуса задачи с оптимистичным обновлением плана и «следующих шагов»
 * и откатом при ошибке (409 для авто-задач, сеть и т.п.).
 */
export function useUpdateTask() {
  const qc = useQueryClient();
  const retryRef = useRef<(v: Vars) => void>(() => undefined);
  const m = useMutation({
    mutationFn: ({ taskId, status }: Vars) => backendApi.updateTask(taskId, status),
    onMutate: async ({ taskId, status }) => {
      await qc.cancelQueries({ queryKey: qk.onboarding });
      const prevPlan = qc.getQueryData<Plan>(qk.plan);
      const prevNext = qc.getQueryData<NextSteps>(qk.nextSteps);
      if (prevPlan) {
        qc.setQueryData<Plan>(qk.plan, {
          stages: prevPlan.stages.map((s) => ({
            ...s,
            tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)),
          })),
        });
      }
      if (prevNext) {
        qc.setQueryData<NextSteps>(qk.nextSteps, {
          ...prevNext,
          steps: prevNext.steps.map((t) => (t.id === taskId ? { ...t, status } : t)),
        });
      }
      return { prevPlan, prevNext };
    },
    onError: (err, vars, ctx) => {
      if (ctx?.prevPlan) qc.setQueryData(qk.plan, ctx.prevPlan);
      if (ctx?.prevNext) qc.setQueryData(qk.nextSteps, ctx.prevNext);
      notifyError(err, () => retryRef.current(vars));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.onboarding }),
  });
  retryRef.current = m.mutate;
  return m;
}
