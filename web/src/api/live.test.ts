import { beforeAll, expect, test } from 'vitest';
import { config } from '@/config';
import { server } from '@/mocks/server';
import { useSession } from '@/stores/session';
import { backendApi } from './backend';
import { agentApi } from './agent';
import type { AgentEvent } from './schemas';

beforeAll(() => {
  if (!process.env.LIVE_API_URL) return;
  server.close();
  config.useMocks = false;
  config.apiUrl = process.env.LIVE_API_URL;
  config.agentUrl = process.env.LIVE_API_URL;
});
test.skipIf(!process.env.LIVE_API_URL)(
  'real frontend clients: login, data, requests, approval and streamed chat',
  async () => {
    const login = await backendApi.login({ username: 'intern_boris', password: 'test1234' });
    useSession.setState({ token: login.access_token, user: login.user });
    expect(login.user.username).toBe('intern_boris');
    const [profile, plan, progress, next, access, requests, suggestions] = await Promise.all([
      backendApi.profile(),
      backendApi.plan(),
      backendApi.progress(),
      backendApi.nextSteps(),
      backendApi.accessOverview(),
      backendApi.requests(),
      agentApi.suggestions(),
    ]);
    expect(profile.user.id).toBe('boris');
    expect(plan.stages.length).toBe(5);
    expect(progress.total_tasks).toBe(15);
    expect(next.steps.length).toBeGreaterThan(0);
    expect(access.systems.length).toBeGreaterThan(0);
    expect(requests.items).toBeInstanceOf(Array);
    expect(suggestions.suggestions[0]?.id).toBeDefined();
    const task = plan.stages.flatMap((s) => s.tasks).find((t) => !t.auto_complete)!;
    expect((await backendApi.updateTask(task.id, 'done')).status).toBe('done');
    await backendApi.updateTask(task.id, task.status);
    const date = new Date(Date.UTC(2028, 0, 1) + Math.floor(Math.random() * 300) * 86400000)
      .toISOString()
      .slice(0, 10);
    const key = crypto.randomUUID();
    const body = { date_from: date, date_to: date, leave_type: 'day_off' as const };
    const req = await backendApi.createLeave(body, key);
    expect((await backendApi.createLeave(body, key)).id).toBe(req.id);
    const lead = await backendApi.login({ username: 'lead_elena', password: 'test1234' });
    useSession.setState({ token: lead.access_token, user: lead.user });
    expect((await backendApi.pendingApprovals()).items.some((r) => r.id === req.id)).toBe(true);
    expect((await backendApi.reject(req.id, 'Integration verification')).status).toBe('rejected');
    useSession.setState({ token: login.access_token, user: login.user });
    const chat = async (message: string) => {
      const events: AgentEvent[] = [];
      for await (const event of agentApi.chat(
        { message, conversation_id: null },
        new AbortController().signal,
      ))
        events.push(event);
      expect(events.filter((e) => e.type === 'error')).toEqual([]);
      expect(events.some((e) => e.type === 'done')).toBe(true);
      return events;
    };
    const leaveEvents = await chat(`Хочу отгул ${date}`);
    const sources = leaveEvents.find((e) => e.type === 'sources');
    expect(sources?.type).toBe('sources');
    if (sources?.type === 'sources' && sources.data.sources[0]) {
      expect((await backendApi.article(sources.data.sources[0].id)).content_md.length).toBeGreaterThan(0);
    }
    const leaveProposal = leaveEvents.find((e) => e.type === 'action_proposal');
    expect(leaveProposal?.type).toBe('action_proposal');
    if (leaveProposal?.type === 'action_proposal') {
      expect((await agentApi.cancel(leaveProposal.data.action_id)).status).toBe('cancelled');
    }
    const confirmedLeaveEvents = await chat(`Хочу отгул ${date}`);
    const confirmedLeave = confirmedLeaveEvents.find((e) => e.type === 'action_proposal');
    expect(confirmedLeave?.type).toBe('action_proposal');
    if (confirmedLeave?.type === 'action_proposal') {
      const result = await agentApi.confirm(confirmedLeave.data.action_id, {
        type: 'leave_request',
        params: body,
      });
      expect(result.status, result.message ?? '').toBe('done');
      expect(result.request_ids).toHaveLength(1);
      useSession.setState({ token: lead.access_token, user: lead.user });
      await backendApi.reject(result.request_ids![0]!, 'Integration verification');
      useSession.setState({ token: login.access_token, user: login.user });
    }
    const accessEvents = await chat('Какие доступы мне нужны?');
    const accessProposal = accessEvents.find((e) => e.type === 'action_proposal');
    expect(accessProposal?.type).toBe('action_proposal');
    if (accessProposal?.type === 'action_proposal' && accessProposal.data.type === 'access_request') {
      const system = accessProposal.data.params.systems[0]!;
      const result = await agentApi.confirm(accessProposal.data.action_id, {
        type: 'access_request',
        params: { system_ids: [system.id], reason: 'Integration verification' },
      });
      expect(result.status, result.message ?? '').toBe('done');
      expect(result.request_ids).toHaveLength(1);
      expect((await agentApi.confirm(accessProposal.data.action_id)).request_ids).toEqual(result.request_ids);
      useSession.setState({ token: lead.access_token, user: lead.user });
      for (const id of result.request_ids ?? []) {
        expect((await backendApi.reject(id, 'Integration verification')).status).toBe('rejected');
      }
      useSession.setState({ token: login.access_token, user: login.user });
    }
    const events: AgentEvent[] = [];
    for await (const event of agentApi.chat(
      { message: 'Что мне делать дальше?', conversation_id: null },
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.some((e) => e.type === 'token')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
    const done = events.find((e) => e.type === 'done');
    if (done?.type === 'done') {
      const history = await backendApi.chatHistory(done.data.conversation_id);
      expect(history.messages.length).toBeGreaterThan(0);
    }
  },
  60000,
);
