import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[1px]" />
        <Dialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl bg-white p-6 shadow-pop data-[state=open]:animate-fade-up"
        >
          <div className="mb-4 flex items-start gap-3">
            <div className="flex-1">
              <Dialog.Title className="text-xl font-bold">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-sm text-ink-soft">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="grid h-9 w-9 place-items-center rounded-xl text-ink-soft hover:bg-canvas"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" aria-hidden />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
