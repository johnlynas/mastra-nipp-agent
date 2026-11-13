'use client';

/**
 * Markdown renderer for agent responses (PHASE 6 follow-up).
 *
 * The portal agent emits standard Markdown (headings, lists, fenced code,
 * GFM tables, links). This wraps react-markdown + remark-gfm in the app's
 * visual language: no Tailwind prose here — styling lives in globals.css
 * under `.md` so it stays consistent with the rest of the chat UI.
 *
 * Streaming-safe: react-markdown re-parses on every text-part update and
 * degrades gracefully on partial syntax (an unclosed fence renders as a code
 * block, an unfinished table row as plain text) — no flicker-prone custom
 * parser needed.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { rehypeHighlight } from '@/lib/highlight';

export function Markdown({ text, query = '' }: { text: string; query?: string }) {
  // Conversation search: a rehype transform wraps matches in <mark> across the
  // whole parsed tree — paragraphs, headings, table cells, links, inline code,
  // and fenced code blocks alike.
  const plugins = [rehypeHighlight(query)];

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={plugins}
        components={{
          // Links open in a new tab; keep the chat session intact.
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          // Code blocks: fence language becomes a label chip on the block.
          code: ({ node, className, children, ...props }) => {
            const isBlock = /language-/.test(className ?? '') || String(children).includes('\n');
            if (isBlock) {
              const lang = (className ?? '').replace(/^language-/, '');
              return (
                <pre className="md-pre">
                  {lang ? <span className="md-lang">{lang}</span> : null}
                  <code>{children}</code>
                </pre>
              );
            }
            return (
              <code className="md-inline" {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
