import type { RequestStatus, RequestType } from './schemas';

/** Единое место для ключей TanStack Query — по префиксам удобно инвалидировать. */
export const qk = {
  me: ['me'] as const,
  profile: ['profile'] as const,
  team: (id: string) => ['team', id] as const,
  onboarding: ['onboarding'] as const,
  readiness: ['onboarding', 'first-day-readiness'] as const,
  plan: ['onboarding', 'plan'] as const,
  progress: ['onboarding', 'progress'] as const,
  nextSteps: ['onboarding', 'next-steps'] as const,
  access: ['access'] as const,
  accessOverview: ['access', 'overview'] as const,
  requests: ['requests'] as const,
  requestList: (f: { type?: RequestType | ''; status?: RequestStatus | '' }) =>
    ['requests', 'list', f] as const,
  request: (id: string) => ['requests', 'detail', id] as const,
  approvals: ['approvals'] as const,
  article: (id: string) => ['knowledge', id] as const,
  suggestions: ['agent', 'suggestions'] as const,
  history: (conversationId: string | null) => ['chat', 'history', conversationId] as const,
};
