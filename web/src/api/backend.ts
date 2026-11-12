import { z } from 'zod';
import { backendHttp, newIdempotencyKey } from './http';
import {
  AccessOverviewSchema,
  AccessRequestResponseSchema,
  ArticleSchema,
  ChatHistorySchema,
  LoginResponseSchema,
  NextStepsSchema,
  PlanSchema,
  ProfileSchema,
  ProgressSchema,
  RequestListSchema,
  RequestSchema,
  TaskSchema,
  TeamSchema,
  UserSchema,
  type AccessForm,
  type LeaveForm,
  type LoginRequest,
  type RequestStatus,
  type RequestType,
  type TaskStatus,
} from './schemas';

/** Типизированный клиент Бэкенда 1 (REST, :8080). Контракт: docs/openapi.yaml. */
export const backendApi = {
  login: (body: LoginRequest) =>
    backendHttp('/auth/login', { method: 'POST', body, schema: LoginResponseSchema, skipAuthRedirect: true }),
  me: () => backendHttp('/auth/me', { schema: UserSchema }),
  profile: () => backendHttp('/me/profile', { schema: ProfileSchema }),
  team: (id: string) => backendHttp(`/teams/${encodeURIComponent(id)}`, { schema: TeamSchema }),

  plan: () => backendHttp('/onboarding/plan', { schema: PlanSchema }),
  progress: () => backendHttp('/onboarding/progress', { schema: ProgressSchema }),
  nextSteps: () => backendHttp('/onboarding/next-steps', { schema: NextStepsSchema }),
  updateTask: (taskId: string, status: TaskStatus) =>
    backendHttp(`/onboarding/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: { status },
      schema: TaskSchema,
    }),

  createLeave: (body: LeaveForm, idempotencyKey: string = newIdempotencyKey()) =>
    backendHttp('/requests/leave', {
      method: 'POST',
      body,
      schema: RequestSchema,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  accessOverview: () => backendHttp('/access/overview', { schema: AccessOverviewSchema }),
  createAccess: (body: AccessForm, idempotencyKey: string = newIdempotencyKey()) =>
    backendHttp('/requests/access', {
      method: 'POST',
      body,
      schema: AccessRequestResponseSchema,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  requests: (filters: { type?: RequestType | ''; status?: RequestStatus | '' } = {}) =>
    backendHttp('/requests', { query: filters, schema: RequestListSchema }),
  request: (id: string) => backendHttp(`/requests/${encodeURIComponent(id)}`, { schema: RequestSchema }),

  pendingApprovals: () => backendHttp('/approvals/pending', { schema: RequestListSchema }),
  approve: (id: string, comment?: string) =>
    backendHttp(`/requests/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: { comment: comment || undefined },
      schema: RequestSchema,
    }),
  reject: (id: string, comment?: string) =>
    backendHttp(`/requests/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: { comment: comment || undefined },
      schema: RequestSchema,
    }),

  article: (id: string) => backendHttp(`/knowledge/${encodeURIComponent(id)}`, { schema: ArticleSchema }),
  chatHistory: (conversationId?: string | null) =>
    backendHttp('/chat/history', { query: { conversation_id: conversationId }, schema: ChatHistorySchema }),
};

export type BackendApi = typeof backendApi;
export const EmptySchema = z.unknown();
