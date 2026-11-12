import type { QueryClient } from '@tanstack/react-query';
import { backendApi } from '@/api/backend';
import { agentApi } from '@/api/agent';
import { qk } from '@/api/queryKeys';
import type { Role } from '@/api/schemas';

/** Префетч данных главной сразу после логина — экран открывается без скелетонов. */
export function prefetchHome(qc: QueryClient, role: Role): Promise<unknown> {
  const jobs: Promise<unknown>[] = [
    qc.prefetchQuery({ queryKey: qk.profile, queryFn: backendApi.profile }),
    qc.prefetchQuery({ queryKey: qk.suggestions, queryFn: agentApi.suggestions }),
    qc.prefetchQuery({ queryKey: qk.history(null), queryFn: () => backendApi.chatHistory() }),
  ];
  if (role === 'intern') {
    jobs.push(
      qc.prefetchQuery({ queryKey: qk.nextSteps, queryFn: backendApi.nextSteps }),
      qc.prefetchQuery({ queryKey: qk.progress, queryFn: backendApi.progress }),
      qc.prefetchQuery({ queryKey: qk.accessOverview, queryFn: backendApi.accessOverview }),
    );
  }
  if (role === 'lead') {
    jobs.push(qc.prefetchQuery({ queryKey: qk.approvals, queryFn: backendApi.pendingApprovals }));
  }
  return Promise.all(jobs);
}
