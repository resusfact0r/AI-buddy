import { z } from 'zod';

/* ───────────── Общие ───────────── */

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ожидается дата YYYY-MM-DD');
export const isoDateTime = z.string().min(1);

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export const RoleSchema = z.enum(['intern', 'buddy', 'lead']);
export type Role = z.infer<typeof RoleSchema>;

export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  display_name: z.string(),
  role: RoleSchema,
  team_id: z.string().nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const PersonSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  position: z.string().nullish(),
  contact: z.string().nullish(),
});
export type Person = z.infer<typeof PersonSchema>;

/* ───────────── Auth / профиль / команда ───────────── */

export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1, 'Введите логин'),
  password: z.string().min(1, 'Введите пароль'),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  access_token: z.string().min(1),
  user: UserSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const TeamShortSchema = z.object({ id: z.string(), name: z.string() });

export const ProfileSchema = z.object({
  user: UserSchema,
  team: TeamShortSchema.nullable(),
  buddy: PersonSchema.nullable(),
  lead: PersonSchema.nullable(),
  start_date: isoDate.nullish(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const TeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  lead: PersonSchema.nullable(),
  members: z.array(PersonSchema).default([]),
});
export type Team = z.infer<typeof TeamSchema>;

/* ───────────── Онбординг ───────────── */

export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'done']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  /** Машинный код задачи, например `get_access`. */
  code: z.string().nullish(),
  stage_id: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  required: z.boolean(),
  status: TaskStatusSchema,
  /** Задача закрывается системой сама (например, «Получить доступы»). Менять статус вручную нельзя. */
  auto_complete: z.boolean().default(false),
  due_date: isoDate.nullish(),
});
export type Task = z.infer<typeof TaskSchema>;

export const StageSchema = z.object({
  id: z.string(),
  title: z.string(),
  order: z.number(),
  description: z.string().nullish(),
  tasks: z.array(TaskSchema),
});
export type Stage = z.infer<typeof StageSchema>;

export const PlanSchema = z.object({ stages: z.array(StageSchema) });
export type Plan = z.infer<typeof PlanSchema>;

export const StageProgressSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.number(),
  total: z.number(),
  status: z.enum(['done', 'current', 'upcoming']),
});
export type StageProgress = z.infer<typeof StageProgressSchema>;

export const ProgressSchema = z.object({
  percent: z.number().min(0).max(100),
  done_tasks: z.number(),
  total_tasks: z.number(),
  current_stage_id: z.string().nullable(),
  stages: z.array(StageProgressSchema),
});
export type Progress = z.infer<typeof ProgressSchema>;

export const NextStepsSchema = z.object({
  current_stage: z.object({ id: z.string(), title: z.string() }).nullable(),
  steps: z.array(TaskSchema).max(3),
});
export type NextSteps = z.infer<typeof NextStepsSchema>;

export const UpdateTaskRequestSchema = z.object({ status: TaskStatusSchema });

/* ───────────── Доступы ───────────── */

export const AccessStatusSchema = z.enum(['granted', 'requested', 'missing']);
export type AccessStatus = z.infer<typeof AccessStatusSchema>;

export const AccessSystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string(),
  required: z.boolean(),
  status: AccessStatusSchema,
  request_id: z.string().nullish(),
});
export type AccessSystem = z.infer<typeof AccessSystemSchema>;

export const AccessOverviewSchema = z.object({
  systems: z.array(AccessSystemSchema),
  granted: z.number(),
  total: z.number(),
});
export type AccessOverview = z.infer<typeof AccessOverviewSchema>;

/* ───────────── Заявки ───────────── */

export const LeaveTypeSchema = z.enum(['day_off', 'vacation', 'sick_leave']);
export type LeaveType = z.infer<typeof LeaveTypeSchema>;
export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  day_off: 'Отгул',
  vacation: 'Отпуск',
  sick_leave: 'Больничный',
};

export const RequestStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;
export const RequestTypeSchema = z.enum(['leave', 'access']);
export type RequestType = z.infer<typeof RequestTypeSchema>;

export const LeaveDetailsSchema = z.object({
  date_from: isoDate,
  date_to: isoDate,
  leave_type: LeaveTypeSchema,
  comment: z.string().nullish(),
});
export type LeaveDetails = z.infer<typeof LeaveDetailsSchema>;

export const AccessDetailsSchema = z.object({
  system_id: z.string(),
  system_name: z.string(),
  reason: z.string().nullish(),
});
export type AccessDetails = z.infer<typeof AccessDetailsSchema>;

const RequestBase = z.object({
  id: z.string(),
  number: z.string(),
  status: RequestStatusSchema,
  author: PersonSchema,
  created_at: isoDateTime,
  updated_at: isoDateTime.nullish(),
  decision_comment: z.string().nullish(),
  decided_by: PersonSchema.nullish(),
  decided_at: isoDateTime.nullish(),
});

export const RequestSchema = z.discriminatedUnion('type', [
  RequestBase.extend({ type: z.literal('leave'), leave: LeaveDetailsSchema }),
  RequestBase.extend({ type: z.literal('access'), access: AccessDetailsSchema }),
]);
export type WorkRequest = z.infer<typeof RequestSchema>;

export const RequestListSchema = z.object({ items: z.array(RequestSchema) });

/** Форма отгула: общая для карточки в чате и ручного оформления. */
export const MAX_LEAVE_DAYS = 14;
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
export function daysInclusive(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000) + 1;
}

export const LeaveFormSchema = z
  .object({
    date_from: isoDate,
    date_to: isoDate,
    leave_type: LeaveTypeSchema,
    comment: z.string().max(500, 'Не больше 500 символов').optional(),
  })
  .superRefine((v, ctx) => {
    if (v.date_from < todayIso()) {
      ctx.addIssue({ code: 'custom', path: ['date_from'], message: 'Дата не может быть в прошлом' });
    }
    if (v.date_from > v.date_to) {
      ctx.addIssue({ code: 'custom', path: ['date_to'], message: 'Дата окончания раньше даты начала' });
    } else if (daysInclusive(v.date_from, v.date_to) > MAX_LEAVE_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['date_to'], message: `Не больше ${MAX_LEAVE_DAYS} дней подряд` });
    }
  });
export type LeaveForm = z.infer<typeof LeaveFormSchema>;

export const AccessFormSchema = z.object({
  system_ids: z.array(z.string()).min(1, 'Выберите хотя бы одну систему'),
  reason: z.string().trim().min(3, 'Коротко опишите, зачем нужен доступ').max(500, 'Не больше 500 символов'),
});
export type AccessForm = z.infer<typeof AccessFormSchema>;

export const AccessRequestResponseSchema = z.object({ requests: z.array(RequestSchema) });

export const DecisionSchema = z.object({ comment: z.string().max(500).optional() });

/* ───────────── База знаний и история чата ───────────── */

export const SourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  snippet: z.string().nullish(),
});
export type Source = z.infer<typeof SourceSchema>;

export const ArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  content_md: z.string(),
  team_id: z.string().nullish(),
  updated_at: isoDateTime.nullish(),
  url: z.string().nullish(),
});
export type Article = z.infer<typeof ArticleSchema>;

/* ───────────── Агент: действия ───────────── */

export const AccessSystemOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string().nullish(),
});

export const LeaveProposalParamsSchema = LeaveDetailsSchema;
export const AccessProposalParamsSchema = z.object({
  systems: z.array(AccessSystemOptionSchema).min(1),
  reason: z.string().nullish(),
});
export const TaskStatusProposalParamsSchema = z.object({
  task_id: z.string(),
  task_title: z.string(),
  status: TaskStatusSchema,
});
export const DecisionProposalParamsSchema = z.object({
  request_id: z.string(),
  request_number: z.string(),
  request_type: RequestTypeSchema,
  author_name: z.string(),
  /** Человекочитаемая суть: «14–15 ноября, отгул» или «GitLab». */
  summary: z.string(),
  reason: z.string().nullish(),
  comment: z.string().nullish(),
});

const ProposalBase = z.object({ action_id: z.string(), title: z.string().nullish() });

export const ActionProposalSchema = z.discriminatedUnion('type', [
  ProposalBase.extend({ type: z.literal('leave_request'), params: LeaveProposalParamsSchema }),
  ProposalBase.extend({ type: z.literal('access_request'), params: AccessProposalParamsSchema }),
  ProposalBase.extend({ type: z.literal('task_status'), params: TaskStatusProposalParamsSchema }),
  ProposalBase.extend({ type: z.literal('approve'), params: DecisionProposalParamsSchema }),
  ProposalBase.extend({ type: z.literal('reject'), params: DecisionProposalParamsSchema }),
]);
export type ActionProposal = z.infer<typeof ActionProposalSchema>;
export type ActionType = ActionProposal['type'];

export const ActionResultStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'done',
  'failed',
  'cancelled',
]);
export type ActionResultStatus = z.infer<typeof ActionResultStatusSchema>;

export const ActionResultSchema = z.object({
  action_id: z.string(),
  status: ActionResultStatusSchema,
  message: z.string().nullish(),
  request_ids: z.array(z.string()).nullish(),
  request_numbers: z.array(z.string()).nullish(),
  retryable: z.boolean().nullish(),
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

/** Параметры confirm: если пользователь изменил карточку — передаём новые значения. */
export type ConfirmParams =
  | { type: 'leave_request'; params: LeaveForm }
  | { type: 'access_request'; params: AccessForm }
  | { type: 'approve' | 'reject'; params: { comment?: string } }
  | { type: 'task_status'; params?: undefined };

/* ───────────── Агент: SSE-события ───────────── */

export const StatusEventSchema = z.object({ text: z.string(), stage: z.string().nullish() });
export const TokenEventSchema = z.object({ text: z.string() });
export const SourcesEventSchema = z.object({ sources: z.array(SourceSchema) });
export const ErrorEventSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().default(false),
});
export const DoneEventSchema = z.object({
  conversation_id: z.string(),
  message_id: z.string().nullish(),
});

export type AgentEvent =
  | { type: 'status'; data: z.infer<typeof StatusEventSchema> }
  | { type: 'token'; data: z.infer<typeof TokenEventSchema> }
  | { type: 'sources'; data: z.infer<typeof SourcesEventSchema> }
  | { type: 'action_proposal'; data: ActionProposal }
  | { type: 'action_result'; data: ActionResult }
  | { type: 'error'; data: z.infer<typeof ErrorEventSchema> }
  | { type: 'done'; data: z.infer<typeof DoneEventSchema> };

export const AGENT_EVENT_SCHEMAS = {
  status: StatusEventSchema,
  token: TokenEventSchema,
  sources: SourcesEventSchema,
  action_proposal: ActionProposalSchema,
  action_result: ActionResultSchema,
  error: ErrorEventSchema,
  done: DoneEventSchema,
} as const;

export const SuggestionsSchema = z.object({
  suggestions: z.array(z.object({ id: z.string(), text: z.string() })),
});
export type Suggestion = z.infer<typeof SuggestionsSchema>['suggestions'][number];

export const HistoryMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  created_at: isoDateTime,
  sources: z.array(SourceSchema).nullish(),
  action: ActionProposalSchema.nullish(),
  action_result: ActionResultSchema.nullish(),
});
export type HistoryMessage = z.infer<typeof HistoryMessageSchema>;

export const ChatHistorySchema = z.object({
  conversation_id: z.string().nullable(),
  messages: z.array(HistoryMessageSchema),
});
export type ChatHistory = z.infer<typeof ChatHistorySchema>;
