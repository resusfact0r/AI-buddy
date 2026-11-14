import { useEffect, useRef, type KeyboardEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { useChat, useChatFocus } from '@/stores/chat';
import { cn } from '@/lib/cn';

export function Composer({ autoFocus }: { autoFocus?: boolean }) {
  const draft = useChat((s) => s.draft);
  const setDraft = useChat((s) => s.setDraft);
  const send = useChat((s) => s.send);
  const stop = useChat((s) => s.stop);
  const streaming = useChat((s) => s.streaming);
  const ref = useRef<HTMLTextAreaElement>(null);
  const focusNonce = useChatFocus((s) => s.nonce);

  // «Спросить AI-buddy» снаружи → фокус в поле, курсор в конец
  useEffect(() => {
    if (focusNonce === 0) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusNonce]);

  // авто-высота
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  // предзаполненный вопрос — фокус в поле
  useEffect(() => {
    if (autoFocus || draft) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  const submit = () => {
    if (streaming || !draft.trim()) return;
    void send(draft);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      className="flex items-end gap-2 rounded-2xl border-2 border-transparent bg-canvas p-1.5 pl-4 transition-colors focus-within:border-ink focus-within:bg-white"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="chat-input" className="sr-only">
        Сообщение для AI-buddy
      </label>
      <textarea
        id="chat-input"
        ref={ref}
        rows={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Спросите AI-buddy…"
        className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] font-medium outline-none placeholder:font-normal placeholder:text-ink-muted focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      {streaming ? (
        <button
          type="button"
          onClick={stop}
          aria-label="Остановить ответ"
          title="Остановить"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink text-white hover:bg-ink/85"
        >
          <Square className="h-4 w-4" fill="currentColor" aria-hidden />
        </button>
      ) : (
        <button
          type="submit"
          aria-label="Отправить"
          title="Отправить (Enter)"
          disabled={!draft.trim()}
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors',
            draft.trim() ? 'bg-ink text-white hover:bg-ink/85' : 'bg-line text-ink-muted',
          )}
        >
          <ArrowUp className="h-5 w-5" aria-hidden />
        </button>
      )}
    </form>
  );
}
