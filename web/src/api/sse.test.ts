import {
  readAgentStream,
  SseParser,
  StreamIdleTimeoutError,
  StreamInterruptedError,
  toAgentEvent,
} from './sse';
import type { AgentEvent } from './schemas';

const enc = new TextEncoder();

function streamOf(
  chunks: string[],
  opts: { close?: boolean; delayMs?: number } = {},
): ReadableStream<Uint8Array> {
  const { close = true, delayMs = 0 } = opts;
  return new ReadableStream({
    async start(c) {
      for (const ch of chunks) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        c.enqueue(enc.encode(ch));
      }
      if (close) c.close();
    },
  });
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

async function collect(it: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('SseParser', () => {
  it('разбирает события, разбитые по чанкам произвольно', () => {
    const p = new SseParser();
    const text = frame('token', { text: 'При' }) + frame('token', { text: 'вет' });
    const out = [];
    for (let i = 0; i < text.length; i += 7) out.push(...p.push(text.slice(i, i + 7)));
    expect(out.map((e) => JSON.parse(e.data).text)).toEqual(['При', 'вет']);
  });

  it('CRLF, многострочный data, комментарии, id и событие по умолчанию', () => {
    const p = new SseParser();
    const out = p.push(': ping\r\nid: 7\r\ndata: a\r\ndata: b\r\n\r\ndata\n\n');
    expect(out[0]).toEqual({ event: 'message', data: 'a\nb', id: '7' });
    expect(out[1]).toEqual({ event: 'message', data: '', id: '7' });
  });

  it('flush досбрасывает последнее событие без пустой строки', () => {
    const p = new SseParser();
    expect(p.push('event: done\ndata: {}')).toEqual([]);
    expect(p.flush()).toEqual([{ event: 'done', data: '{}' }]);
    expect(p.flush()).toEqual([]);
  });
});

describe('toAgentEvent', () => {
  it('отбрасывает неизвестные, не-JSON и не по схеме', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(toAgentEvent({ event: 'ping', data: '{}' })).toBeNull();
    expect(toAgentEvent({ event: 'token', data: 'not json' })).toBeNull();
    expect(toAgentEvent({ event: 'token', data: '{"txt":1}' })).toBeNull();
    expect(toAgentEvent({ event: 'token', data: '{"text":"a"}' })).toEqual({
      type: 'token',
      data: { text: 'a' },
    });
    warn.mockRestore();
  });
});

describe('readAgentStream', () => {
  it('отдаёт все типы событий', async () => {
    const proposal = {
      action_id: 'a1',
      type: 'leave_request',
      params: { date_from: '2026-11-13', date_to: '2026-11-13', leave_type: 'day_off' },
    };
    const body = streamOf([
      frame('status', { text: 'Ищу…' }),
      frame('token', { text: 'Да' }),
      frame('sources', { sources: [{ id: 'kb', title: 'T' }] }),
      frame('action_proposal', proposal),
      frame('action_result', { action_id: 'a1', status: 'pending' }),
      frame('done', { conversation_id: 'c1' }),
    ]);
    const events = await collect(readAgentStream(body));
    expect(events.map((e) => e.type)).toEqual([
      'status',
      'token',
      'sources',
      'action_proposal',
      'action_result',
      'done',
    ]);
  });

  it('error завершает стрим без исключения', async () => {
    const events = await collect(
      readAgentStream(
        streamOf([frame('error', { code: 'upstream_unavailable', message: 'down', retryable: true })]),
      ),
    );
    expect(events).toEqual([
      { type: 'error', data: { code: 'upstream_unavailable', message: 'down', retryable: true } },
    ]);
  });

  it('обрыв (поток закрылся без done) → StreamInterruptedError', async () => {
    await expect(collect(readAgentStream(streamOf([frame('token', { text: 'a' })])))).rejects.toBeInstanceOf(
      StreamInterruptedError,
    );
  });

  it('ошибка чтения → StreamInterruptedError', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(frame('token', { text: 'a' })));
        c.error(new Error('reset'));
      },
    });
    await expect(collect(readAgentStream(body))).rejects.toBeInstanceOf(StreamInterruptedError);
  });

  it('тишина дольше idleTimeout → StreamIdleTimeoutError', async () => {
    const body = streamOf([], { close: false });
    await expect(collect(readAgentStream(body, { idleTimeoutMs: 20 }))).rejects.toBeInstanceOf(
      StreamIdleTimeoutError,
    );
  });

  it('отмена через AbortController — тихое завершение', async () => {
    const ctrl = new AbortController();
    const body = streamOf([frame('token', { text: 'a' }), frame('token', { text: 'b' })], {
      close: false,
      delayMs: 5,
    });
    const out: AgentEvent[] = [];
    for await (const e of readAgentStream(body, { signal: ctrl.signal })) {
      out.push(e);
      ctrl.abort();
    }
    expect(out).toHaveLength(1);
  });

  it('уже отменённый сигнал — сразу выходим', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(
      await collect(
        readAgentStream(streamOf([frame('done', { conversation_id: 'c' })]), { signal: ctrl.signal }),
      ),
    ).toEqual([]);
  });
});
