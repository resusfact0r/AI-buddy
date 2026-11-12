import { create } from 'zustand';
import { agentApi } from '@/api/agent';
import { toApiError } from '@/api/errors';
import { StreamIdleTimeoutError, StreamInterruptedError } from '@/api/sse';
import type {
  ActionProposal,
  ActionResult,
  AgentEvent,
  ChatHistory,
  ConfirmParams,
  Source,
} from '@/api/schemas';

export type ActionPhase = 'proposed' | 'submitting' | 'result' | 'cancelled';

export interface ActionState {
  proposal: ActionProposal;
  phase: ActionPhase;
  result?: ActionResult;
  /** Ошибка вызова confirm (сеть/сервер) — показываем в карточке с «Повторить». */
  error?: { message: string; retryable: boolean };
}

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  text: string;
  status: string | null;
  sources: Source[];
  actions: ActionState[];
  error: { message: string; retryable: boolean } | null;
  streaming: boolean;
  stopped: boolean;
  /** Текст вопроса — для «Повторить». */
  replyTo: string;
}

export type ChatMessage = UserMessage | AssistantMessage;

interface ChatState {
  messages: ChatMessage[];
  conversationId: string | null;
  streaming: boolean;
  /** Предзаполненный вопрос (из плана, из «Спросить AI-buddy»). */
  draft: string;
  historyLoaded: boolean;
  controller: AbortController | null;
  onActionResult: ((r: ActionResult, p: ActionProposal) => void) | null;

  send: (text: string) => Promise<void>;
  stop: () => void;
  retry: (assistantId: string) => Promise<void>;
  confirmAction: (actionId: string, edited?: ConfirmParams) => Promise<void>;
  cancelAction: (actionId: string) => Promise<void>;
  setDraft: (text: string) => void;
  loadHistory: (h: ChatHistory) => void;
  setOnActionResult: (fn: ChatState['onActionResult']) => void;
  reset: () => void;
}

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`;

const initial = {
  messages: [] as ChatMessage[],
  conversationId: null as string | null,
  streaming: false,
  draft: '',
  historyLoaded: false,
  controller: null as AbortController | null,
};

/** Применение одного SSE-события к сообщению ассистента (чистая функция — легко тестировать). */
export function applyEvent(msg: AssistantMessage, ev: AgentEvent): AssistantMessage {
  switch (ev.type) {
    case 'status':
      return { ...msg, status: ev.data.text };
    case 'token':
      return { ...msg, text: msg.text + ev.data.text, status: null };
    case 'sources':
      return { ...msg, sources: ev.data.sources };
    case 'action_proposal':
      if (msg.actions.some((a) => a.proposal.action_id === ev.data.action_id)) return msg;
      return { ...msg, actions: [...msg.actions, { proposal: ev.data, phase: 'proposed' }] };
    case 'action_result':
      return {
        ...msg,
        actions: msg.actions.map((a) =>
          a.proposal.action_id === ev.data.action_id ? { ...a, phase: phaseOf(ev.data), result: ev.data } : a,
        ),
      };
    case 'error':
      return {
        ...msg,
        status: null,
        streaming: false,
        error: { message: ev.data.message, retryable: ev.data.retryable },
      };
    case 'done':
      return { ...msg, status: null, streaming: false };
  }
}

const phaseOf = (r: ActionResult): ActionPhase => (r.status === 'cancelled' ? 'cancelled' : 'result');

export const useChat = create<ChatState>()((set, get) => {
  const patchAssistant = (id: string, fn: (m: AssistantMessage) => AssistantMessage) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id && m.role === 'assistant' ? fn(m) : m)),
    }));

  const patchAction = (actionId: string, fn: (a: ActionState) => ActionState) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.role === 'assistant' && m.actions.some((a) => a.proposal.action_id === actionId)
          ? { ...m, actions: m.actions.map((a) => (a.proposal.action_id === actionId ? fn(a) : a)) }
          : m,
      ),
    }));

  const findAction = (actionId: string): ActionState | undefined => {
    for (const m of get().messages) {
      if (m.role !== 'assistant') continue;
      const a = m.actions.find((x) => x.proposal.action_id === actionId);
      if (a) return a;
    }
    return undefined;
  };

  return {
    ...initial,
    onActionResult: null,

    async send(raw) {
      const text = raw.trim();
      if (!text || get().streaming) return;
      const userMsg: UserMessage = { id: uid('u'), role: 'user', text };
      const asst: AssistantMessage = {
        id: uid('a'),
        role: 'assistant',
        text: '',
        status: 'Думаю…',
        sources: [],
        actions: [],
        error: null,
        streaming: true,
        stopped: false,
        replyTo: text,
      };
      const controller = new AbortController();
      set((s) => ({ messages: [...s.messages, userMsg, asst], streaming: true, controller, draft: '' }));

      try {
        for await (const ev of agentApi.chat(
          { message: text, conversation_id: get().conversationId },
          controller.signal,
        )) {
          patchAssistant(asst.id, (m) => applyEvent(m, ev));
          if (ev.type === 'done') set({ conversationId: ev.data.conversation_id });
          if (ev.type === 'action_result') {
            const a = findAction(ev.data.action_id);
            if (a) get().onActionResult?.(ev.data, a.proposal);
          }
        }
        if (controller.signal.aborted) {
          patchAssistant(asst.id, (m) => ({ ...m, streaming: false, status: null, stopped: true }));
        }
      } catch (e) {
        if (controller.signal.aborted) {
          patchAssistant(asst.id, (m) => ({ ...m, streaming: false, status: null, stopped: true }));
        } else {
          const message =
            e instanceof StreamInterruptedError || e instanceof StreamIdleTimeoutError
              ? `${e.message}. Ответ может быть неполным.`
              : toApiError(e).message;
          const retryable =
            e instanceof StreamInterruptedError ||
            e instanceof StreamIdleTimeoutError ||
            toApiError(e).retryable;
          patchAssistant(asst.id, (m) => ({
            ...m,
            streaming: false,
            status: null,
            error: { message, retryable },
          }));
        }
      } finally {
        patchAssistant(asst.id, (m) => (m.streaming ? { ...m, streaming: false, status: null } : m));
        if (get().controller === controller) set({ streaming: false, controller: null });
      }
    },

    stop() {
      get().controller?.abort();
    },

    async retry(assistantId) {
      const msgs = get().messages;
      const idx = msgs.findIndex((m) => m.id === assistantId);
      const msg = msgs[idx];
      if (!msg || msg.role !== 'assistant' || get().streaming) return;
      // убираем неудачную пару «вопрос — ответ» и отправляем вопрос заново
      const prev = msgs[idx - 1];
      const cut = prev?.role === 'user' ? idx - 1 : idx;
      set({ messages: msgs.filter((_, i) => i !== idx && i !== cut) });
      await get().send(msg.replyTo);
    },

    async confirmAction(actionId, edited) {
      const a = findAction(actionId);
      if (!a || a.phase === 'submitting') return;
      patchAction(actionId, (x) => ({ ...x, phase: 'submitting', error: undefined }));
      try {
        const result = await agentApi.confirm(actionId, edited);
        patchAction(actionId, (x) => ({ ...x, phase: phaseOf(result), result }));
        get().onActionResult?.(result, a.proposal);
      } catch (e) {
        const err = toApiError(e);
        patchAction(actionId, (x) => ({
          ...x,
          phase: 'proposed',
          error: { message: err.message, retryable: err.retryable },
        }));
      }
    },

    async cancelAction(actionId) {
      const a = findAction(actionId);
      if (!a || a.phase !== 'proposed') return;
      // Отмена мгновенно в UI; если сервер не ответил — действие всё равно не будет выполнено без confirm.
      patchAction(actionId, (x) => ({ ...x, phase: 'cancelled', error: undefined }));
      try {
        await agentApi.cancel(actionId);
      } catch {
        /* не критично */
      }
    },

    setDraft(text) {
      set({ draft: text });
    },

    loadHistory(h) {
      if (get().historyLoaded || get().messages.length > 0) {
        set({ historyLoaded: true });
        return;
      }
      const messages: ChatMessage[] = h.messages.map((m): ChatMessage => {
        if (m.role === 'user') return { id: m.id, role: 'user', text: m.content };
        const actions: ActionState[] = m.action
          ? [
              {
                proposal: m.action,
                phase: m.action_result ? phaseOf(m.action_result) : 'proposed',
                result: m.action_result ?? undefined,
              },
            ]
          : [];
        return {
          id: m.id,
          role: 'assistant',
          text: m.content,
          status: null,
          sources: m.sources ?? [],
          actions,
          error: null,
          streaming: false,
          stopped: false,
          replyTo: '',
        };
      });
      set({ messages, conversationId: h.conversation_id, historyLoaded: true });
    },

    setOnActionResult(fn) {
      set({ onActionResult: fn });
    },

    reset() {
      get().controller?.abort();
      set({ ...initial, onActionResult: get().onActionResult });
    },
  };
});

/** Открыть чат с предзаполненным вопросом (из плана, следующих шагов). */
export const useChatFocus = create<{ nonce: number; request: () => void }>()((set) => ({
  nonce: 0,
  request: () => set((s) => ({ nonce: s.nonce + 1 })),
}));

export function askBuddy(text: string): void {
  useChat.getState().setDraft(text);
  useChatFocus.getState().request();
}
