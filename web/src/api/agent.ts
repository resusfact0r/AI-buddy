import { z } from 'zod';
import { config } from '@/config';
import { agentHttp, authHeaders, buildUrl, handleUnauthorized } from './http';
import { errorFromResponse, toApiError } from './errors';
import { readAgentStream } from './sse';
import { ActionResultSchema, SuggestionsSchema, type AgentEvent, type ConfirmParams } from './schemas';

export const CancelResultSchema = z.object({ action_id: z.string(), status: z.literal('cancelled') });

/** Типизированный клиент Бэкенда 2 (ИИ-агент, :8081). Контракт: docs/agent-api.md. */
export const agentApi = {
  suggestions: () => agentHttp('/agent/suggestions', { schema: SuggestionsSchema }),

  confirm: (actionId: string, edited?: ConfirmParams) =>
    agentHttp(`/agent/actions/${encodeURIComponent(actionId)}/confirm`, {
      method: 'POST',
      body: {
        params:
          !config.useMocks && edited?.type === 'leave_request'
            ? {
                date_from: edited.params.date_from,
                date_to: edited.params.date_to,
                reason_type: edited.params.leave_type,
                comment: edited.params.comment,
              }
            : !config.useMocks && edited?.type === 'access_request'
              ? { systems: edited.params.system_ids, reason: edited.params.reason }
              : (edited?.params ?? null),
      },
      schema: ActionResultSchema,
      timeoutMs: 30_000,
    }),

  cancel: (actionId: string) =>
    agentHttp(`/agent/actions/${encodeURIComponent(actionId)}/cancel`, {
      method: 'POST',
      body: {},
      schema: CancelResultSchema,
    }),

  /**
   * POST /agent/chat → text/event-stream. EventSource не умеет POST и заголовки,
   * поэтому читаем поток через fetch + ReadableStream.
   */
  async *chat(
    body: { message: string; conversation_id: string | null },
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    let res: Response;
    try {
      res = await fetch(buildUrl(config.agentUrl, '/agent/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...authHeaders() },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal.aborted) return;
      throw toApiError(e);
    }
    if (!res.ok) {
      const err = await errorFromResponse(res);
      if (err.kind === 'unauthorized') handleUnauthorized();
      throw err;
    }
    if (!res.body) throw toApiError(new Error('empty body'));
    yield* readAgentStream(res.body, { signal, idleTimeoutMs: config.streamIdleTimeoutMs });
  },
};
