import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown } from 'lucide-react';
import { agentApi } from '@/api/agent';
import { backendApi } from '@/api/backend';
import { qk } from '@/api/queryKeys';
import { useChat } from '@/stores/chat';
import { useSession } from '@/stores/session';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { LogoMark } from '@/components/Logo';
import { Message } from './Message';
import { Composer } from './Composer';

function Suggestions() {
  const send = useChat((s) => s.send);
  const streaming = useChat((s) => s.streaming);
  const q = useQuery({ queryKey: qk.suggestions, queryFn: agentApi.suggestions, staleTime: 5 * 60_000 });
  if (q.isPending) {
    return (
      <div className="flex flex-wrap justify-center gap-2" aria-label="Загрузка подсказок">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-40" />
      </div>
    );
  }
  if (q.isError) return null; // подсказки — не критично, чат работает и без них
  return (
    <ul className="flex flex-wrap justify-center gap-2" aria-label="Подсказки">
      {q.data.suggestions.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            disabled={streaming}
            onClick={() => void send(s.text)}
            className="rounded-full bg-canvas px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-50"
          >
            {s.text}
          </button>
        </li>
      ))}
    </ul>
  );
}

function EmptyChat() {
  const name = useSession((s) => s.user?.display_name.split(' ')[0]);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-4 py-8 text-center">
      <LogoMark className="h-16 w-16 rounded-3xl" />
      <div>
        <p className="text-[28px] font-extrabold leading-tight tracking-tight">
          {name ? `${name}, чем помочь?` : 'Чем помочь?'}
        </p>
        <p className="mt-1.5 font-medium text-ink-soft">Спросите о плане, команде, отгуле или доступах.</p>
      </div>
      <Suggestions />
    </div>
  );
}

/** Подгружает историю один раз за сессию. */
function useHistory() {
  const loadHistory = useChat((s) => s.loadHistory);
  const historyLoaded = useChat((s) => s.historyLoaded);
  const q = useQuery({
    queryKey: qk.history(null),
    queryFn: () => backendApi.chatHistory(),
    enabled: !historyLoaded,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (q.data && !historyLoaded) loadHistory(q.data);
  }, [q.data, historyLoaded, loadHistory]);
  return {
    loading: !historyLoaded && q.isPending,
    error: !historyLoaded && q.isError ? q.error : null,
    refetch: q.refetch,
  };
}

export function ChatPanel({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const messages = useChat((s) => s.messages);
  const streaming = useChat((s) => s.streaming);
  const history = useHistory();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Автоскролл — только если пользователь не прокрутил вверх.
  useLayoutEffect(() => {
    if (stuck) scrollToBottom();
  }, [messages, stuck, scrollToBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setStuck(atBottom);
  };

  return (
    <section
      aria-label="Чат с AI-buddy"
      className={cn('relative flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white', className)}
    >
      <header className="flex items-center gap-3 border-b border-line px-5 py-4 sm:px-6">
        <span className="relative" aria-hidden>
          <LogoMark className="h-10 w-10 rounded-xl" />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-ok" />
        </span>
        <div className="leading-tight">
          <h2 className="text-lg font-extrabold">AI-buddy</h2>
          <p className="text-xs font-medium text-ink-soft">
            {streaming ? 'печатает…' : 'ваш наставник, отвечает сразу'}
          </p>
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={streaming}
      >
        {history.loading ? (
          <div className="space-y-4" role="status" aria-label="Загрузка истории">
            <Skeleton className="ml-auto h-10 w-2/3" />
            <Skeleton className="h-24 w-4/5" />
          </div>
        ) : history.error ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : messages.length === 0 ? (
          <EmptyChat />
        ) : (
          <div className="space-y-5">
            {messages.map((m) => (
              <Message key={m.id} msg={m} />
            ))}
          </div>
        )}
      </div>

      {!stuck && messages.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setStuck(true);
            scrollToBottom(true);
          }}
          className="absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white shadow-pop"
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden /> К последним сообщениям
        </button>
      )}

      <div className="px-3 pb-3 pt-1 sm:px-5 sm:pb-4">
        <Composer autoFocus={autoFocus} />
        <p className="mt-1.5 px-1 text-[11px] text-ink-muted">
          Enter — отправить, Shift+Enter — новая строка. AI-buddy может ошибаться — действия выполняются
          только после вашего подтверждения.
        </p>
      </div>
    </section>
  );
}
