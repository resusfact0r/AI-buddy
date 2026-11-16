import { z } from 'zod';
import { config } from '@/config';
import { useSession } from '@/stores/session';
import { backendHttp } from './http';
import type { WorkRequest } from './schemas';

/**
 * В заявках бэк отдаёт только коды: `user_id`, `decided_by`, `system_code`.
 * Справочник собирает человекочитаемые названия из эндпоинтов, которые бэк уже отдаёт:
 * профиль (я, наставник, руководитель), команда (`tools`) и, для руководителя, его стажёры.
 */
export interface Directory {
  people: Map<string, string>;
  systems: Map<string, string>;
}

const ProfileNamesSchema = z.object({
  user: z.object({ id: z.string(), display_name: z.string().nullish() }).passthrough(),
  buddy: z.object({ id: z.string(), display_name: z.string() }).nullish(),
  lead: z.object({ id: z.string(), display_name: z.string() }).nullish(),
  team: z.object({ id: z.string() }).passthrough().nullish(),
});
const TeamToolsSchema = z.object({
  tools: z.array(z.object({ system_code: z.string(), title: z.string() })).default([]),
});
const InternsSchema = z.object({
  interns: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
});

let cache: { token: string; promise: Promise<Directory> } | null = null;

async function build(): Promise<Directory> {
  const people = new Map<string, string>();
  const systems = new Map<string, string>();
  const { user } = useSession.getState();
  const safe = <T>(p: Promise<T>) => p.catch(() => null);

  const [profile, team, interns] = await Promise.all([
    safe(backendHttp('/me/profile', { schema: ProfileNamesSchema })),
    user?.team_id
      ? safe(backendHttp(`/teams/${encodeURIComponent(user.team_id)}`, { schema: TeamToolsSchema }))
      : null,
    // В режиме моков заявки уже приходят с именами, а эндпоинта стажёров у моков нет.
    user?.role === 'lead' && !config.useMocks
      ? safe(backendHttp('/onboarding/first-day-readiness', { schema: InternsSchema }))
      : null,
  ]);

  if (user) people.set(user.id, user.display_name);
  for (const p of [profile?.buddy, profile?.lead]) if (p) people.set(p.id, p.display_name);
  for (const i of interns?.interns ?? []) people.set(i.id, i.name);
  for (const t of team?.tools ?? []) systems.set(t.system_code, t.title);
  return { people, systems };
}

export function loadDirectory(): Promise<Directory> {
  const token = useSession.getState().token ?? '';
  if (!cache || cache.token !== token) {
    cache = { token, promise: build() };
  }
  return cache.promise;
}

export function resetDirectory(): void {
  cache = null;
}

/** Подставляет имена и названия, только если бэк прислал вместо них сырые коды. */
export function enrichRequest(r: WorkRequest, d: Directory): WorkRequest {
  const name = (id: string, current: string) => (current === id ? (d.people.get(id) ?? current) : current);
  const base = {
    ...r,
    author: { ...r.author, display_name: name(r.author.id, r.author.display_name) },
    decided_by: r.decided_by
      ? { ...r.decided_by, display_name: name(r.decided_by.id, r.decided_by.display_name) }
      : r.decided_by,
  };
  if (base.type === 'access' && base.access.system_name === base.access.system_id) {
    const title = d.systems.get(base.access.system_id);
    if (title) return { ...base, access: { ...base.access, system_name: title } };
  }
  return base;
}

export async function withDirectory<T extends WorkRequest | { items: WorkRequest[] }>(
  data: Promise<T>,
): Promise<T> {
  const [value, dir] = await Promise.all([data, loadDirectory().catch(() => null)]);
  if (!dir) return value;
  if ('items' in value) return { ...value, items: value.items.map((r) => enrichRequest(r, dir)) };
  return enrichRequest(value, dir) as T;
}
