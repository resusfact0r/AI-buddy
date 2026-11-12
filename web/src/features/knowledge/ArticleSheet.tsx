import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, X } from 'lucide-react';
import { backendApi } from '@/api/backend';
import { qk } from '@/api/queryKeys';
import { Markdown } from '@/components/Markdown';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { Badge } from '@/components/ui/Badge';
import { formatDateTime } from '@/lib/dates';
import { useArticle } from './articleStore';

/** Боковая панель со статьёй базы знаний (по клику на источник в чате). */
export function ArticleSheet() {
  const { openId, close } = useArticle();
  const q = useQuery({
    queryKey: qk.article(openId ?? ''),
    queryFn: () => backendApi.article(openId!),
    enabled: Boolean(openId),
    staleTime: 5 * 60_000,
  });

  return (
    <Dialog.Root open={Boolean(openId)} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[1px] data-[state=open]:animate-fade-up" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-white shadow-pop data-[state=open]:animate-fade-up sm:rounded-l-3xl"
        >
          <div className="flex items-start gap-3 border-b border-line p-5">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"
              aria-hidden
            >
              <BookOpen className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-bold leading-snug">
                {q.data?.title ?? (q.isError ? 'Статья' : 'Загрузка…')}
              </Dialog.Title>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                <Badge tone="warn">Демо-версия, тестовые данные</Badge>
                {q.data?.updated_at && <span>обновлено {formatDateTime(q.data.updated_at)}</span>}
              </div>
            </div>
            <Dialog.Close
              className="grid h-9 w-9 place-items-center rounded-xl text-ink-soft hover:bg-canvas"
              aria-label="Закрыть статью"
            >
              <X className="h-5 w-5" aria-hidden />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {q.isPending && (
              <div className="space-y-3" role="status" aria-label="Загрузка статьи">
                <Skeleton className="h-7 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            )}
            {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
            {q.data && <Markdown>{q.data.content_md}</Markdown>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
