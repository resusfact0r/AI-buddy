import { http as mswHttp, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { config } from '@/config';
import { loginAs } from '@/test/utils';
import { applyEvent, askBuddy, useChat, useChatFocus, type AssistantMessage } from './chat';

const G = (p: string) => `${config.agentUrl}${p}`;
const st = () => useChat.getState();
const lastAssistant = () =>
  st()
    .messages.filter((m) => m.role === 'assistant')
    .at(-1) as AssistantMessage;

describe('chat store', () => {
  beforeEach(() => loginAs('intern_anna'));

  it('send: стрим отгула → текст, источник, карточка, conversation_id', async () => {
    await st().send('Хочу отгул в пятницу');
    const m = lastAssistant();
    expect(m.streaming).toBe(false);
    expect(m.text).toMatch(/за 2 рабочих дня/);
    expect(m.sources[0]!.id).toBe('kb-leave');
    expect(m.actions[0]!.proposal.type).toBe('leave_request');
    expect(st().conversationId).toBe('conv-u-anna');
    expect(st().streaming).toBe(false);
  });

  it('пустое сообщение и повторная отправка во время стрима игнорируются', async () => {
    await st().send('   ');
    expect(st().messages).toHaveLength(0);
    useChat.setState({ streaming: true });
    await st().send('привет');
    expect(st().messages).toHaveLength(0);
  });

  it('confirm → результат и колбэк инвалидации', async () => {
    const cb = vi.fn();
    st().setOnActionResult(cb);
    await st().send('Хочу отгул завтра');
    const id = lastAssistant().actions[0]!.proposal.action_id;
    await st().confirmAction(id);
    const a = lastAssistant().actions[0]!;
    expect(a.phase).toBe('result');
    expect(a.result!.status).toBe('pending');
    expect(a.result!.request_numbers![0]).toMatch(/^REQ-/);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('confirm с сетевой ошибкой → обратно в proposed с retryable ошибкой', async () => {
    await st().send('Хочу отгул завтра');
    const id = lastAssistant().actions[0]!.proposal.action_id;
    server.use(mswHttp.post(G('/agent/actions/:id/confirm'), () => HttpResponse.error()));
    await st().confirmAction(id);
    const a = lastAssistant().actions[0]!;
    expect(a.phase).toBe('proposed');
    expect(a.error!.retryable).toBe(true);
  });

  it('cancel → cancelled, повторно не отменяется', async () => {
    await st().send('Какие доступы мне нужны?');
    const id = lastAssistant().actions[0]!.proposal.action_id;
    await st().cancelAction(id);
    expect(lastAssistant().actions[0]!.phase).toBe('cancelled');
    await st().cancelAction(id);
    await st().confirmAction('missing');
  });

  it('HTTP 503 до стрима → ошибка с «Повторить», retry проходит', async () => {
    await st().send('[сбой] как у нас код-ревью?');
    let m = lastAssistant();
    expect(m.error).toEqual({ message: expect.stringMatching(/временно недоступен/), retryable: true });
    await st().retry(m.id);
    m = lastAssistant();
    expect(m.error).toBeNull();
    expect(m.text).toMatch(/два ревьюера/);
    expect(st().messages).toHaveLength(2);
  });

  it('событие error внутри стрима', async () => {
    await st().send('[ошибка] привет');
    expect(lastAssistant().error!.message).toMatch(/недоступна/);
  });

  it('обрыв стрима → понятная ошибка', async () => {
    server.use(
      mswHttp.post(G('/agent/chat'), () => {
        const body = new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('event: token\ndata: {"text":"Нач"}\n\n'));
            c.close();
          },
        });
        return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );
    await st().send('привет');
    const m = lastAssistant();
    expect(m.text).toBe('Нач');
    expect(m.error!.message).toMatch(/прервалось/);
    expect(m.error!.retryable).toBe(true);
  });

  it('stop → сообщение помечено «Остановлено»', async () => {
    server.use(
      mswHttp.post(G('/agent/chat'), () => {
        const body = new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('event: status\ndata: {"text":"Думаю"}\n\n'));
          },
        });
        return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );
    const p = st().send('привет');
    await vi.waitFor(() => expect(lastAssistant().status).toBe('Думаю'));
    st().stop();
    await p;
    expect(lastAssistant().stopped).toBe(true);
    expect(st().streaming).toBe(false);
  });

  it('loadHistory маппит сообщения и действия; не перетирает текущий чат', () => {
    st().loadHistory({
      conversation_id: 'c1',
      messages: [
        { id: '1', role: 'user', content: 'q', created_at: 'x' },
        {
          id: '2',
          role: 'assistant',
          content: 'a',
          created_at: 'x',
          sources: [{ id: 's', title: 'S' }],
          action: {
            action_id: 'a1',
            type: 'task_status',
            params: { task_id: 't', task_title: 'T', status: 'done' },
          },
          action_result: { action_id: 'a1', status: 'cancelled' },
        },
      ],
    });
    expect(st().messages).toHaveLength(2);
    expect(lastAssistant().actions[0]!.phase).toBe('cancelled');
    expect(st().conversationId).toBe('c1');
    st().loadHistory({ conversation_id: 'c2', messages: [] });
    expect(st().conversationId).toBe('c1');
  });

  it('askBuddy ставит черновик и запрашивает фокус', () => {
    const before = useChatFocus.getState().nonce;
    askBuddy('Помоги');
    expect(st().draft).toBe('Помоги');
    expect(useChatFocus.getState().nonce).toBe(before + 1);
  });
});

describe('applyEvent', () => {
  const base: AssistantMessage = {
    id: 'a',
    role: 'assistant',
    text: '',
    status: 'Думаю…',
    sources: [],
    actions: [],
    error: null,
    streaming: true,
    stopped: false,
    replyTo: 'q',
  };
  it('token снимает статус, дубликаты proposal игнорируются, action_result меняет фазу', () => {
    let m = applyEvent(base, { type: 'token', data: { text: 'Hi' } });
    expect(m.status).toBeNull();
    const proposal = {
      action_id: 'x',
      type: 'task_status' as const,
      params: { task_id: 't', task_title: 'T', status: 'done' as const },
    };
    m = applyEvent(m, { type: 'action_proposal', data: proposal });
    m = applyEvent(m, { type: 'action_proposal', data: proposal });
    expect(m.actions).toHaveLength(1);
    m = applyEvent(m, { type: 'action_result', data: { action_id: 'x', status: 'done' } });
    expect(m.actions[0]!.phase).toBe('result');
    m = applyEvent(m, { type: 'done', data: { conversation_id: 'c' } });
    expect(m.streaming).toBe(false);
  });
});
