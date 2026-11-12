import { ChatPanel } from '@/features/chat/ChatPanel';

export function ChatPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <ChatPanel autoFocus className="h-[calc(100dvh-10.5rem)] min-h-[480px]" />
    </div>
  );
}
