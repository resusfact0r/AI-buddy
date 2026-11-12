import { FileText } from 'lucide-react';
import type { Source } from '@/api/schemas';
import { useArticle } from '@/features/knowledge/articleStore';

export function SourceChips({ sources }: { sources: Source[] }) {
  const open = useArticle((s) => s.open);
  if (!sources.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2" aria-label="Источники">
      {sources.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => open(s.id)}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-brand hover:text-brand"
          title={s.snippet ?? 'Открыть статью'}
        >
          <FileText className="h-4 w-4 shrink-0 text-brand" aria-hidden />
          <span className="truncate">{s.title}</span>
        </button>
      ))}
    </div>
  );
}
