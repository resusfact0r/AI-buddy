import { useEffect, useRef, useState } from 'react';
import type { BuddyMood } from '@/components/Buddy';
import { useChat, type ChatMessage } from '@/stores/chat';

/** Сколько маскот радуется найденному ответу, прежде чем вернуться к простою. */
export const FOUND_MS = 1800;

/** Фаза последнего ответа: ждём первого содержимого, ответ уже есть, либо покой. */
export type ReplyPhase = 'waiting' | 'answered' | 'rest';

export function replyPhase(messages: ChatMessage[], streaming: boolean): ReplyPhase {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return streaming ? 'waiting' : 'rest';
  const hasContent = last.text.length > 0 || last.actions.length > 0;
  if (last.streaming && !hasContent) return 'waiting';
  if (hasContent && !last.error && !last.stopped) return 'answered';
  return 'rest';
}

/**
 * Настроение маскота по состоянию чата: пока ответа нет — думает,
 * в момент появления ответа коротко радуется, в остальное время — простой.
 * Ошибка и остановка радости не вызывают.
 */
export function useBuddyMood(): BuddyMood {
  const phase = useChat((s) => replyPhase(s.messages, s.streaming));
  const [found, setFound] = useState(false);
  const prev = useRef<ReplyPhase>(phase);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const was = prev.current;
    prev.current = phase;
    if (phase === 'waiting') {
      clearTimeout(timer.current);
      setFound(false);
      return;
    }
    if (was === 'waiting' && phase === 'answered') {
      clearTimeout(timer.current);
      setFound(true);
      timer.current = setTimeout(() => setFound(false), FOUND_MS);
    }
  }, [phase]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (phase === 'waiting') return 'thinking';
  return found ? 'found' : 'idle';
}
