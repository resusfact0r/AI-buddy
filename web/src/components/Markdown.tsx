import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Безопасный markdown: сырой HTML отбрасывается (skipHtml), опасные URL (javascript: и т.п.)
 * вычищает стандартный urlTransform react-markdown, ссылки открываются в новой вкладке.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {c}
            </a>
          ),
          img: () => null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
