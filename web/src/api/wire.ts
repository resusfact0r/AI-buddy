const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const person = (value: unknown) => {
  const p = object(value);
  return p.id ? { ...p, display_name: p.display_name ?? p.full_name ?? p.id } : null;
};
const task = (value: unknown) => {
  const t = object(value);
  return { ...t, auto_complete: t.auto_complete ?? t.code === 'get_access' };
};
const system = (value: unknown) => {
  const s = object(value);
  return {
    ...s,
    id: s.id ?? s.system_code ?? s.system,
    name: s.name ?? s.title ?? s.system_code ?? s.system,
  };
};
/** У заявок бэка нет номера, только длинный hex-id. Показываем короткую форму. */
export function shortRequestNumber(id: string): string {
  return /^[0-9a-f]{16,}$/i.test(id) ? `№ ${id.slice(0, 6).toUpperCase()}` : id;
}
const REQUEST_STATUSES = ['pending', 'approved', 'rejected'];
export function normalizeRequest(value: unknown): unknown {
  const r = object(value);
  if (!r.payload) return value;
  const p = object(r.payload);
  return {
    ...r,
    number: shortRequestNumber(String(r.id)),
    author: { id: r.user_id, display_name: r.user_id },
    decided_by: r.decided_by ? { id: r.decided_by, display_name: r.decided_by } : null,
    leave: r.type === 'leave' ? { ...p, leave_type: p.reason_type } : undefined,
    access:
      r.type === 'access'
        ? { system_id: p.system_code, system_name: p.system_code, reason: p.reason }
        : undefined,
  };
}
export function normalizeBackend(path: string, value: unknown): unknown {
  const v = object(value);
  if (path === '/auth/login') return { ...v, user: normalizeBackend('/auth/me', v.user) };
  if (path === '/auth/me')
    return { ...v, username: v.username ?? v.login, display_name: v.display_name ?? v.full_name };
  if (path === '/me/profile')
    return {
      ...v,
      user: normalizeBackend('/auth/me', v.user),
      buddy: person(v.buddy),
      lead: person(v.lead),
      start_date: v.start_date ?? object(v.user).start_date,
    };
  if (path.startsWith('/teams/')) return { ...v, lead: person(v.lead) };
  if (path === '/onboarding/plan')
    return {
      ...v,
      stages: array(v.stages).map((x) => {
        const s = object(x);
        return { ...s, order: s.order ?? s.ord, tasks: array(s.tasks).map(task) };
      }),
    };
  if (path === '/access/overview' && Array.isArray(value))
    return {
      systems: value.map(system),
      granted: value.filter((x) => object(x).status === 'granted').length,
      total: value.length,
    };
  if (path === '/requests' || path === '/approvals/pending')
    return { items: array(Array.isArray(value) ? value : v.items).map(normalizeRequest) };
  if (path.startsWith('/requests/')) return normalizeRequest(value);
  if (path.startsWith('/knowledge/')) return { ...v, content_md: v.content_md ?? v.body };
  if (path === '/chat/history' && Array.isArray(value))
    return {
      conversation_id: object(value[0]).conversation_id ?? null,
      messages: value
        .filter((x) => ['user', 'assistant'].includes(String(object(x).role)))
        .map((x, i) => {
          const m = object(x);
          return { ...m, id: String(m.id ?? i), created_at: m.created_at ?? '', ...object(m.meta) };
        }),
    };
  return value;
}
export function normalizeAgent(event: string, value: unknown): unknown {
  const v = object(value);
  if (event === 'action_result') {
    const data = object(v.data);
    const requests = array(data.results).map((r) => object(object(r).request));
    if (data.id) requests.push(data);
    const created = requests.filter((r) => r.id);
    // Агент сообщает статус действия («done»), а в карточке нужен статус созданной заявки.
    const statuses = [...new Set(created.map((r) => String(r.status)))];
    const requestStatus =
      v.status === 'done' && statuses.length === 1 && REQUEST_STATUSES.includes(statuses[0]!)
        ? statuses[0]
        : v.status;
    return {
      ...v,
      status: requestStatus,
      request_ids: v.request_ids ?? created.map((r) => String(r.id)),
      request_numbers: v.request_numbers ?? created.map((r) => shortRequestNumber(String(r.id))),
      retryable: v.retryable ?? object(v.error).retryable,
    };
  }
  if (event === 'sources') return Array.isArray(value) ? { sources: value } : value;
  if (event === 'suggestions')
    return {
      ...v,
      suggestions: array(v.suggestions).map((x, i) => ({ ...object(x), id: object(x).id ?? String(i) })),
    };
  if (event === 'action_proposal') {
    const p = object(v.params);
    const options = object(v.options);
    if (v.type === 'leave_request')
      return { ...v, params: { ...p, leave_type: p.leave_type ?? p.reason_type } };
    if (v.type === 'access_request')
      return { ...v, params: { ...p, systems: array(options.systems ?? p.systems).map(system) } };
    if (v.type === 'task_status')
      return {
        ...v,
        params: { ...p, task_title: p.task_title ?? options.task_title ?? v.title ?? p.task_id },
      };
    if (v.type === 'approve' || v.type === 'reject')
      return {
        ...v,
        params: {
          ...p,
          request_number: p.request_number ?? p.request_id,
          request_type: p.request_type ?? object(options.request).type ?? 'leave',
          author_name: p.author_name ?? '',
          summary: p.summary ?? v.summary ?? '',
        },
      };
  }
  return value;
}
