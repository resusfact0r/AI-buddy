import type {
  AccessStatus,
  ActionProposal,
  ActionResult,
  HistoryMessage,
  LeaveDetails,
  Person,
  Source,
  Task,
  TaskStatus,
  WorkRequest,
} from '@/api/schemas';
import {
  INITIAL_ACCESS,
  INITIAL_TASK_STATUS,
  PLAN_TEMPLATE,
  SYSTEMS_BY_TEAM,
  TEAMS,
  USERS,
  type MockUser,
} from './data';

/** Ошибка в формате контракта {"error":{code,message,details}}. */
export class MockHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface PendingAction {
  proposal: ActionProposal;
  userId: string;
  result?: ActionResult;
}

interface DbState {
  tasks: Record<string, Record<string, TaskStatus>>;
  access: Record<string, Record<string, AccessStatus>>;
  accessRequestId: Record<string, Record<string, string>>;
  requests: WorkRequest[];
  seq: number;
  history: Record<string, HistoryMessage[]>;
  conversations: Record<string, string>;
  actions: Record<string, PendingAction>;
  failedOnce: string[];
}

const STORAGE_KEY = 'ai-buddy-mock-db-v1';

function initialState(): DbState {
  return {
    tasks: structuredClone(INITIAL_TASK_STATUS),
    access: structuredClone(INITIAL_ACCESS),
    accessRequestId: {},
    requests: [],
    seq: 1040,
    history: {},
    conversations: {},
    actions: {},
    failedOnce: [],
  };
}

let state: DbState = initialState();
let persistEnabled = false;

export function enablePersistence(): void {
  persistEnabled = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) state = { ...initialState(), ...(JSON.parse(raw) as Partial<DbState>) };
  } catch {
    /* хранилище недоступно — работаем в памяти */
  }
}

export function save(): void {
  if (!persistEnabled) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function resetDb(): void {
  state = initialState();
  save();
}

export const db = {
  get state() {
    return state;
  },
};

/* ───────── Пользователи ───────── */

export function userById(id: string): MockUser {
  const u = USERS.find((x) => x.id === id);
  if (!u) throw new MockHttpError(404, 'not_found', 'Пользователь не найден');
  return u;
}

export function userByToken(header: string | null): MockUser {
  const token = header?.replace(/^Bearer\s+/i, '') ?? '';
  const username = token.startsWith('mock.') ? token.slice(5) : '';
  const user = USERS.find((u) => u.username === username);
  if (!user) throw new MockHttpError(401, 'unauthorized', 'Требуется вход');
  return user;
}

export function toPerson(u: MockUser): Person {
  return { id: u.id, display_name: u.display_name, position: u.position, contact: u.contact };
}

export function teamOf(user: MockUser) {
  return TEAMS.find((t) => t.id === user.team_id) ?? null;
}

export function buddyOf(user: MockUser): MockUser | null {
  const id = teamOf(user)?.buddy_by_intern[user.id];
  return id ? userById(id) : null;
}

export function leadOf(user: MockUser): MockUser | null {
  const t = teamOf(user);
  return t ? userById(t.lead_id) : null;
}

export function requireIntern(user: MockUser): void {
  if (user.role !== 'intern') throw new MockHttpError(403, 'forbidden', 'Доступно только стажёрам');
}

export function requireLead(user: MockUser): void {
  if (user.role !== 'lead') throw new MockHttpError(403, 'forbidden', 'Доступно только руководителям');
}

/* ───────── Онбординг ───────── */

export function planFor(userId: string) {
  const statuses = state.tasks[userId] ?? {};
  return PLAN_TEMPLATE.map((st, i) => ({
    id: st.id,
    title: st.title,
    order: i + 1,
    description: st.description,
    tasks: st.tasks.map<Task>((t) => ({
      id: t.id,
      code: t.code ?? null,
      stage_id: st.id,
      title: t.title,
      description: t.description,
      required: t.required,
      auto_complete: Boolean(t.auto_complete),
      status: statuses[t.id] ?? 'todo',
      due_date: null,
    })),
  }));
}

export function progressFor(userId: string) {
  const stages = planFor(userId);
  let currentFound = false;
  let currentId: string | null = null;
  const stageProgress = stages.map((s) => {
    const required = s.tasks.filter((t) => t.required);
    const done = required.filter((t) => t.status === 'done').length;
    let status: 'done' | 'current' | 'upcoming' = 'upcoming';
    if (done === required.length) status = 'done';
    else if (!currentFound) {
      status = 'current';
      currentFound = true;
      currentId = s.id;
    }
    return { id: s.id, title: s.title, done, total: required.length, status };
  });
  const all = stages.flatMap((s) => s.tasks).filter((t) => t.required);
  const doneAll = all.filter((t) => t.status === 'done').length;
  return {
    percent: Math.round((doneAll / all.length) * 100),
    done_tasks: doneAll,
    total_tasks: all.length,
    current_stage_id: currentId,
    stages: stageProgress,
  };
}

export function nextStepsFor(userId: string) {
  const plan = planFor(userId);
  const progress = progressFor(userId);
  const stage = plan.find((s) => s.id === progress.current_stage_id) ?? null;
  const open = stage ? stage.tasks.filter((t) => t.status !== 'done') : [];
  open.sort((a, b) => Number(b.required) - Number(a.required));
  return {
    current_stage: stage ? { id: stage.id, title: stage.title } : null,
    steps: open.slice(0, 3),
  };
}

export function findTask(userId: string, taskId: string): Task {
  const task = planFor(userId)
    .flatMap((s) => s.tasks)
    .find((t) => t.id === taskId);
  if (!task) throw new MockHttpError(404, 'not_found', 'Задача не найдена');
  return task;
}

export function setTaskStatus(userId: string, taskId: string, status: TaskStatus): Task {
  const task = findTask(userId, taskId);
  if (task.auto_complete) {
    throw new MockHttpError(
      409,
      'conflict',
      'Задача «Получить доступы» закрывается автоматически, когда выданы все обязательные доступы',
    );
  }
  state.tasks[userId] = { ...(state.tasks[userId] ?? {}), [taskId]: status };
  save();
  return { ...task, status };
}

/* ───────── Доступы ───────── */

export function accessFor(user: MockUser) {
  const systems = (SYSTEMS_BY_TEAM[user.team_id ?? ''] ?? []).map((s) => ({
    ...s,
    status: state.access[user.id]?.[s.id] ?? ('missing' as AccessStatus),
    request_id: state.accessRequestId[user.id]?.[s.id] ?? null,
  }));
  return { systems, granted: systems.filter((s) => s.status === 'granted').length, total: systems.length };
}

function syncAutoTasks(user: MockUser): void {
  const required = accessFor(user).systems.filter((s) => s.required);
  if (required.every((s) => s.status === 'granted')) {
    state.tasks[user.id] = { ...(state.tasks[user.id] ?? {}), 'get-access': 'done' };
  }
}

/* ───────── Заявки ───────── */

function nextNumber(): string {
  state.seq += 1;
  return `REQ-${state.seq}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const idempotency = new Map<string, unknown>();

export function withIdempotency<T>(key: string | null, fn: () => T): T {
  if (key && idempotency.has(key)) return idempotency.get(key) as T;
  const result = fn();
  if (key) idempotency.set(key, result);
  return result;
}

export function createLeave(user: MockUser, body: LeaveDetails): WorkRequest {
  requireIntern(user);
  const fields: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date_from ?? '')) fields.date_from = 'Укажите дату начала';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date_to ?? '')) fields.date_to = 'Укажите дату окончания';
  if (!fields.date_from && body.date_from < todayIso()) fields.date_from = 'Дата не может быть в прошлом';
  if (!fields.date_to && !fields.date_from && body.date_from > body.date_to)
    fields.date_to = 'Дата окончания раньше даты начала';
  if (Object.keys(fields).length) {
    throw new MockHttpError(400, 'validation_error', 'Проверьте поля заявки', { fields });
  }
  const req: WorkRequest = {
    id: crypto.randomUUID(),
    number: nextNumber(),
    type: 'leave',
    status: 'pending',
    author: toPerson(user),
    created_at: nowIso(),
    updated_at: nowIso(),
    leave: {
      date_from: body.date_from,
      date_to: body.date_to,
      leave_type: body.leave_type ?? 'day_off',
      comment: body.comment ?? null,
    },
    decision_comment: null,
    decided_by: null,
    decided_at: null,
  };
  state.requests.unshift(req);
  save();
  return req;
}

export function createAccess(user: MockUser, systemIds: string[], reason: string): WorkRequest[] {
  requireIntern(user);
  if (!systemIds?.length) {
    throw new MockHttpError(400, 'validation_error', 'Выберите системы', {
      fields: { system_ids: 'Выберите хотя бы одну систему' },
    });
  }
  const overview = accessFor(user);
  const created: WorkRequest[] = [];
  for (const id of systemIds) {
    const sys = overview.systems.find((s) => s.id === id);
    if (!sys) throw new MockHttpError(404, 'not_found', 'Система не найдена');
    if (sys.status === 'requested')
      throw new MockHttpError(409, 'conflict', `Доступ к ${sys.name} уже запрошен`);
    if (sys.status === 'granted') throw new MockHttpError(409, 'conflict', `Доступ к ${sys.name} уже есть`);
  }
  for (const id of systemIds) {
    const sys = overview.systems.find((s) => s.id === id)!;
    const req: WorkRequest = {
      id: crypto.randomUUID(),
      number: nextNumber(),
      type: 'access',
      status: 'pending',
      author: toPerson(user),
      created_at: nowIso(),
      updated_at: nowIso(),
      access: { system_id: sys.id, system_name: sys.name, reason },
      decision_comment: null,
      decided_by: null,
      decided_at: null,
    };
    state.requests.unshift(req);
    state.access[user.id] = { ...(state.access[user.id] ?? {}), [sys.id]: 'requested' };
    state.accessRequestId[user.id] = { ...(state.accessRequestId[user.id] ?? {}), [sys.id]: req.id };
    created.push(req);
  }
  save();
  return created;
}

export function requestsFor(user: MockUser, type?: string | null, status?: string | null): WorkRequest[] {
  return state.requests.filter(
    (r) => r.author.id === user.id && (!type || r.type === type) && (!status || r.status === status),
  );
}

export function requestById(user: MockUser, id: string): WorkRequest {
  const r = state.requests.find((x) => x.id === id);
  if (!r) throw new MockHttpError(404, 'not_found', 'Заявка не найдена');
  const author = userById(r.author.id);
  const canSee = r.author.id === user.id || (user.role === 'lead' && leadOf(author)?.id === user.id);
  if (!canSee) throw new MockHttpError(403, 'forbidden', 'Нет доступа к заявке');
  return r;
}

export function pendingFor(lead: MockUser): WorkRequest[] {
  requireLead(lead);
  return state.requests.filter(
    (r) => r.status === 'pending' && leadOf(userById(r.author.id))?.id === lead.id,
  );
}

export function decide(lead: MockUser, id: string, decision: 'approved' | 'rejected', comment?: string) {
  requireLead(lead);
  const r = requestById(lead, id);
  if (r.author.id === lead.id) throw new MockHttpError(403, 'forbidden', 'Нельзя согласовать свою заявку');
  if (r.status !== 'pending') {
    throw new MockHttpError(
      409,
      'conflict',
      `Заявка ${r.number} уже ${r.status === 'approved' ? 'одобрена' : 'отклонена'}`,
    );
  }
  r.status = decision;
  r.decision_comment = comment || null;
  r.decided_by = toPerson(lead);
  r.decided_at = nowIso();
  r.updated_at = nowIso();
  if (r.type === 'access') {
    const author = userById(r.author.id);
    state.access[author.id] = {
      ...(state.access[author.id] ?? {}),
      [r.access.system_id]: decision === 'approved' ? 'granted' : 'missing',
    };
    syncAutoTasks(author);
  }
  save();
  return r;
}

/* ───────── История чата и действия агента ───────── */

export function conversationFor(userId: string): string {
  const existing = state.conversations[userId];
  if (existing) return existing;
  const id = `conv-${userId}`;
  state.conversations[userId] = id;
  return id;
}

export function historyFor(userId: string): HistoryMessage[] {
  return state.history[userId] ?? [];
}

export function appendHistory(
  userId: string,
  msg: { role: 'user' | 'assistant'; content: string; sources?: Source[]; action?: ActionProposal | null },
): void {
  const list = state.history[userId] ?? [];
  list.push({
    id: crypto.randomUUID(),
    role: msg.role,
    content: msg.content,
    created_at: nowIso(),
    sources: msg.sources ?? null,
    action: msg.action ?? null,
    action_result: null,
  });
  state.history[userId] = list.slice(-60);
  save();
}

export function registerAction(userId: string, proposal: ActionProposal): void {
  state.actions[proposal.action_id] = { proposal, userId };
  save();
}

export function setActionResult(actionId: string, result: ActionResult): void {
  const a = state.actions[actionId];
  if (a) a.result = result;
  for (const list of Object.values(state.history)) {
    for (const m of list) if (m.action?.action_id === actionId) m.action_result = result;
  }
  save();
}

export function markFailedOnce(key: string): boolean {
  if (state.failedOnce.includes(key)) return false;
  state.failedOnce.push(key);
  save();
  return true;
}
