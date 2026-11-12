import { config } from '@/config';
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
    backendHttp('/auth/login', {
      method: 'POST',
      body: config.useMocks ? body : { login: body.username, password: body.password },
      schema: LoginResponseSchema,
      skipAuthRedirect: true,
    }),
  me: () => backendHttp('/auth/me', { schema: UserSchema }),
  profile: () => backendHttp('/me/profile', { schema: ProfileSchema }),
  team: (id: string) => backendHttp(`/teams/${encodeURIComponent(id)}`, { schema: TeamSchema }),

  plan: () => backendHttp('/onboarding/plan', { schema: PlanSchema }),
  progress: async () => {
    if (config.useMocks) return backendHttp('/onboarding/progress', { schema: ProgressSchema });
    const plan = await backendApi.plan();
    let current: string | null = null;
    const stages = plan.stages.map((s) => {
      const tasks = s.tasks.filter((t) => t.required);
      const done = tasks.filter((t) => t.status === 'done').length;
      const isCurrent = done < tasks.length && current === null;
      if (isCurrent) current = s.id;
      return {
        id: s.id,
        title: s.title,
        done,
        total: tasks.length,
        status: done === tasks.length ? 'done' : isCurrent ? 'current' : 'upcoming',
      };
    });
    const total = stages.reduce((n, s) => n + s.total, 0),
      done = stages.reduce((n, s) => n + s.done, 0);
    return ProgressSchema.parse({
      percent: total ? Math.floor((done * 100) / total) : 100,
      done_tasks: done,
      total_tasks: total,
      current_stage_id: current,
      stages,
    });
  },
  nextSteps: async () => {
    if (config.useMocks) return backendHttp('/onboarding/next-steps', { schema: NextStepsSchema });
    const plan = await backendApi.plan();
    const stage = plan.stages.find((s) => s.tasks.some((t) => t.required && t.status !== 'done'));
    return NextStepsSchema.parse({
      current_stage: stage ? { id: stage.id, title: stage.title } : null,
      steps: stage?.tasks.filter((t) => t.required && t.status !== 'done').slice(0, 3) ?? [],
    });
  },
  updateTask: async (taskId: string, status: TaskStatus) => {
    const result = await backendHttp(`/onboarding/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: { status },
      schema: config.useMocks ? TaskSchema : z.unknown(),
    });
    if (config.useMocks) return TaskSchema.parse(result);
    const plan = await backendApi.plan();
    return TaskSchema.parse(plan.stages.flatMap((s) => s.tasks).find((t) => t.id === taskId));
  },

  createLeave: (body: LeaveForm, idempotencyKey: string = newIdempotencyKey()) =>
    backendHttp('/requests/leave', {
      method: 'POST',
      body: config.useMocks
        ? body
        : {
            date_from: body.date_from,
            date_to: body.date_to,
            reason_type: body.leave_type,
            comment: body.comment,
          },
      schema: RequestSchema,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  accessOverview: () => backendHttp('/access/overview', { schema: AccessOverviewSchema }),
  createAccess: async (body: AccessForm, idempotencyKey: string = newIdempotencyKey()) => {
    if (config.useMocks)
      return backendHttp('/requests/access', {
        method: 'POST',
        body,
        schema: AccessRequestResponseSchema,
        headers: { 'Idempotency-Key': idempotencyKey },
      });
    const requests = [];
    for (const code of body.system_ids) {
      requests.push(
        await backendHttp('/requests/access', {
          method: 'POST',
          body: { system_code: code, reason: body.reason },
          schema: RequestSchema,
          headers: { 'Idempotency-Key': `${idempotencyKey}:${code}` },
        }),
      );
    }
    return { requests };
  },

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
