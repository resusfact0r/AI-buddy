import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { useChat, type AssistantMessage, type ChatMessage, type UserMessage } from '@/stores/chat';
import { FOUND_MS, replyPhase, useBuddyMood } from './useBuddyMood';

const user: UserMessage = { id: 'u1', role: 'user', text: 'Как у нас проходит код-ревью?' };

function reply(patch: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: 'a1',
    role: 'assistant',
    text: '',
    status: 'Думаю…',
    sources: [],
    actions: [],
    error: null,
    streaming: true,
    stopped: false,
    replyTo: user.text,
    ...patch,
  };
}

function setChat(messages: ChatMessage[], streaming: boolean) {
  act(() => useChat.setState({ messages, streaming }));
}

describe('replyPhase', () => {
  it('пустой чат — покой', () => {
    expect(replyPhase([], false)).toBe('rest');
  });

  it('ответ ещё без содержимого — ждём', () => {
    expect(replyPhase([user, reply()], true)).toBe('waiting');
  });

  it('пришёл текст или карточка действия — ответ есть', () => {
    expect(replyPhase([user, reply({ text: 'Два ревьюера', status: null })], true)).toBe('answered');
    const action = { proposal: { action_id: 'x' }, phase: 'proposed' } as AssistantMessage['actions'][number];
    expect(replyPhase([user, reply({ actions: [action] })], true)).toBe('answered');
  });

  it('ошибка и остановка — покой, даже если текст успел прийти', () => {
    const error = { message: 'Сервис временно недоступен', retryable: true };
    expect(replyPhase([user, reply({ streaming: false, error })], false)).toBe('rest');
    expect(replyPhase([user, reply({ text: 'Два', streaming: false, stopped: true })], false)).toBe('rest');
  });
});

describe('useBuddyMood', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('простой → думает → ответ найден → снова простой', () => {
    const { result } = renderHook(() => useBuddyMood());
    expect(result.current).toBe('idle');

    setChat([user, reply()], true);
    expect(result.current).toBe('thinking');

    setChat([user, reply({ text: 'Два ревьюера', status: null })], true);
    expect(result.current).toBe('found');

    // Стрим закончился раньше, чем радость, — радость не обрывается и не залипает.
    setChat([user, reply({ text: 'Два ревьюера', status: null, streaming: false })], false);
    expect(result.current).toBe('found');

    act(() => vi.advanceTimersByTime(FOUND_MS));
    expect(result.current).toBe('idle');
  });

  it('ошибка без ответа не вызывает радости', () => {
    const { result } = renderHook(() => useBuddyMood());
    setChat([user, reply()], true);
    expect(result.current).toBe('thinking');

    const error = { message: 'Сервис временно недоступен', retryable: true };
    setChat([user, reply({ streaming: false, status: null, error })], false);
    expect(result.current).toBe('idle');
  });

  it('история при загрузке не считается новым ответом', () => {
    setChat([user, reply({ text: 'старый ответ', status: null, streaming: false })], false);
    const { result } = renderHook(() => useBuddyMood());
    expect(result.current).toBe('idle');
  });

  it('новый вопрос сразу прерывает радость', () => {
    const { result } = renderHook(() => useBuddyMood());
    setChat([user, reply()], true);
    setChat([user, reply({ text: 'Готово', status: null, streaming: false })], false);
    expect(result.current).toBe('found');

    setChat(
      [user, reply({ text: 'Готово', streaming: false }), { ...user, id: 'u2' }, reply({ id: 'a2' })],
      true,
    );
    expect(result.current).toBe('thinking');

    act(() => vi.advanceTimersByTime(FOUND_MS));
    expect(result.current).toBe('thinking');
  });
});
