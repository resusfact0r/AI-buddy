import { normalizeAgent } from './wire';
import { AGENT_EVENT_SCHEMAS, type AgentEvent } from './schemas';

export interface RawSseEvent {
  event: string;
  data: string;
  id?: string;
}

/**
 * Инкрементальный парсер text/event-stream (по спецификации WHATWG):
 * события разделены пустой строкой, поддерживаются \n, \r\n и \r, многострочный data, комментарии ":".
 */
export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];
  private id: string | undefined;

  push(chunk: string): RawSseEvent[] {
    this.buffer += chunk;
    const out: RawSseEvent[] = [];
    // Отделяем завершённые строки; хвост без перевода строки остаётся в буфере.
    const lines = this.buffer.split(/\r\n|\r|\n/);
    // Если чанк закончился на \r, следующий может начаться с \n — не теряем это.
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const ev = this.consumeLine(line);
      if (ev) out.push(ev);
    }
    return out;
  }

  /** Досбросить последнее событие, если стрим закончился без пустой строки. */
  flush(): RawSseEvent[] {
    const out: RawSseEvent[] = [];
    if (this.buffer) {
      const ev = this.consumeLine(this.buffer);
      this.buffer = '';
      if (ev) out.push(ev);
    }
    const ev = this.dispatch();
    if (ev) out.push(ev);
    return out;
  }

  private consumeLine(line: string): RawSseEvent | null {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return null;
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    else if (field === 'id') this.id = value;
    return null;
  }

  private dispatch(): RawSseEvent | null {
    if (this.data.length === 0 && !this.event) return null;
    const ev: RawSseEvent = { event: this.event || 'message', data: this.data.join('\n') };
    if (this.id !== undefined) ev.id = this.id;
    this.event = '';
    this.data = [];
    return ev;
  }
}

/** Проверяет событие Zod-схемой. Неизвестные типы и битые данные → null (игнорируем, но логируем). */
export function toAgentEvent(raw: RawSseEvent): AgentEvent | null {
  const schema = AGENT_EVENT_SCHEMAS[raw.event as keyof typeof AGENT_EVENT_SCHEMAS];
  if (!schema) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw.data);
  } catch {
    console.warn('[sse] data не JSON', raw);
    return null;
  }
  const parsed = schema.safeParse(normalizeAgent(raw.event, json));
  if (!parsed.success) {
    console.warn('[sse] событие не по контракту', raw.event, parsed.error.issues);
    return null;
  }
  return { type: raw.event, data: parsed.data } as AgentEvent;
}

export class StreamInterruptedError extends Error {
  constructor(message = 'Соединение с AI-buddy прервалось') {
    super(message);
    this.name = 'StreamInterruptedError';
  }
}

export class StreamIdleTimeoutError extends Error {
  constructor() {
    super('AI-buddy слишком долго не отвечает');
    this.name = 'StreamIdleTimeoutError';
  }
}

/**
 * Читает SSE из тела fetch-ответа и отдаёт типизированные события.
 * - отмена: через signal (AbortController) — генератор просто завершается;
 * - обрыв: если стрим закрылся без события `done`/`error` → StreamInterruptedError;
 * - зависание: если idleTimeoutMs нет ни одного байта → StreamIdleTimeoutError.
 */
export async function* readAgentStream(
  body: ReadableStream<Uint8Array>,
  opts: { signal?: AbortSignal; idleTimeoutMs?: number } = {},
): AsyncGenerator<AgentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  let finished = false;

  const onAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  const readWithTimeout = (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (!opts.idleTimeoutMs) return reader.read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new StreamIdleTimeoutError()), opts.idleTimeoutMs);
    });
    return Promise.race([reader.read(), timeout]).finally(() => clearTimeout(timer));
  };

  try {
    while (true) {
      if (opts.signal?.aborted) return;
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await readWithTimeout();
      } catch (e) {
        if (opts.signal?.aborted) return;
        if (e instanceof StreamIdleTimeoutError) throw e;
        throw new StreamInterruptedError();
      }
      if (opts.signal?.aborted) return;
      const raws = chunk.done ? parser.flush() : parser.push(decoder.decode(chunk.value, { stream: true }));
      for (const raw of raws) {
        const ev = toAgentEvent(raw);
        if (!ev) continue;
        if (ev.type === 'done' || ev.type === 'error') finished = true;
        yield ev;
      }
      if (chunk.done) break;
    }
    if (!finished && !opts.signal?.aborted) throw new StreamInterruptedError();
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    reader.releaseLock?.();
  }
}
