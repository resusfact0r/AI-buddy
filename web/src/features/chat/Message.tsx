import { memo } from 'react';
import { AlertTriangle, RotateCw, Square } from 'lucide-react';
import { useChat, type ChatMessage } from '@/stores/chat';
import { Markdown } from '@/components/Markdown';
import { Button } from '@/components/ui/Button';
import { SourceChips } from './SourceChips';
import { ActionCard } from './ActionCard';

export function StatusLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-soft" role="status" aria-live="polite">
      <span className="flex gap-1" aria-hidden>
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand" />
      </span>
      {text}
    </div>
  );
}

function BotAvatar() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand text-white" aria-hidden>
      <svg viewBox="0 0 32 32" className="h-6 w-6">
        <circle cx="11.5" cy="14" r="2.6" fill="currentColor" />
        <circle cx="20.5" cy="14" r="2.6" fill="currentColor" />
        <path
          d="M11 20.5c2.8 2.4 7.2 2.4 10 0"
          stroke="currentColor"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export const Message = memo(function Message({ msg }: { msg: ChatMessage }) {
  const retry = useChat((s) => s.retry);
  const streamingNow = useChat((s) => s.streaming);

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end animate-fade-up">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-[15px] text-white">
          {msg.text}
        </div>
      </div>
    );
  }

  const empty = !msg.text && !msg.actions.length && !msg.error;
  return (
    <div className="flex gap-2.5 animate-fade-up">
      <BotAvatar />
      <div className="min-w-0 max-w-[92%] flex-1">
        {(msg.text || (!msg.status && empty && !msg.stopped)) && (
          <div className="inline-block max-w-full rounded-2xl rounded-tl-md bg-white px-4 py-2.5 shadow-card">
            {msg.text ? (
              <Markdown>{msg.text}</Markdown>
            ) : (
              <span className="text-ink-muted">Пустой ответ</span>
            )}
            {msg.streaming && !msg.status && (
              <span
                className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-brand/60"
                aria-hidden
              />
            )}
          </div>
        )}
        {msg.status && (
          <div className={msg.text ? 'mt-2' : 'py-1.5'}>
            <StatusLine text={msg.status} />
          </div>
        )}
        <SourceChips sources={msg.sources} />
        {msg.actions.map((a) => (
          <ActionCard key={a.proposal.action_id} action={a} />
        ))}
        {msg.stopped && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-muted">
            <Square className="h-3.5 w-3.5" aria-hidden /> Остановлено
          </p>
        )}
        {msg.error && (
          <div
            role="alert"
            className="mt-2 flex flex-wrap items-center gap-3 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{msg.error.message}</span>
            {msg.error.retryable && msg.replyTo && (
              <Button size="sm" variant="outline" disabled={streamingNow} onClick={() => void retry(msg.id)}>
                <RotateCw className="h-3.5 w-3.5" aria-hidden /> Повторить
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
