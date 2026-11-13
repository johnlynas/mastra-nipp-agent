'use client';

/**
 * Streaming chat UI (PHASE 6, DESIGN §5.5.5).
 *
 * Flow on mount: GET /api/session (same-origin; the cookie the portal set at
 * :3000 is host-scoped to `localhost` so it arrives here too). No session →
 * sign-in banner linking to the portal's login page. Signed in → useChat with
 * DefaultChatTransport({ api: '/api/chat', credentials: 'include' }).
 *
 * Rendering: plain-HTML collapsible tool blocks (DESIGN open q2 — AI Elements
 * skipped; the install is light and the surface needed is small). Tool parts
 * arrive as `tool-<name>` / `dynamic-tool` UIMessage parts with a state
 * machine (input-streaming → input-available → output-available | output-error),
 * so each block shows its live state: running spinner, then result preview.
 *
 * 401 mid-conversation (session expired) → the banner reappears: when the chat
 * hits an error status we re-check /api/session and demote to signed-out on 401.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { portalLoginUrl } from '@/lib/portal-url';
import { Markdown } from '@/components/markdown';
import {
  chatToMarkdown,
  defaultChatFilename,
  sanitizeMarkdownFilename,
} from '@/lib/chat-export';
import { highlightText } from '@/lib/highlight';

interface SessionUser {
  id: string;
  name?: string;
  email?: string;
}

type AuthState =
  | { status: 'checking' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: SessionUser };

/** Shape of a tool UIMessage part (ai v7) — the fields we render. */
interface ToolPart {
  type: string; // `tool-<name>` or 'dynamic-tool'
  toolName?: string;
  toolCallId: string;
  state: string; // input-streaming | input-available | output-available | output-error | ...
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function isToolPart(part: UIMessage['parts'][number]): boolean {
  const p = part as { type?: string };
  return typeof p.type === 'string' && (p.type.startsWith('tool-') || p.type === 'dynamic-tool');
}

function toolNameOf(part: ToolPart): string {
  if (part.toolName) return part.toolName;
  return part.type.replace(/^tool-/, '');
}

/** Compact one-line preview of a tool result for the collapsed block. */
function previewOutput(output: unknown): string {
  try {
    const text = typeof output === 'string' ? output : JSON.stringify(output);
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  } catch {
    return String(output);
  }
}

function ToolBlock({ part, query }: { part: ToolPart; query: string }) {
  const [open, setOpen] = useState(false);
  const name = toolNameOf(part);
  const running =
    part.state === 'input-streaming' || part.state === 'input-available';
  const failed = part.state === 'output-error';

  return (
    <div className={`tool-block ${failed ? 'tool-block-error' : ''}`}>
      <button type="button" className="tool-head" onClick={() => setOpen((o) => !o)}>
        {running ? (
          <span className="tool-spinner" aria-hidden="true" />
        ) : (
          <span className={failed ? 'tool-dot tool-dot-err' : 'tool-dot'} aria-hidden="true" />
        )}
        <span className="tool-name">{highlightText(name, query)}</span>
        <span className="tool-state">
          {running
            ? part.state === 'input-streaming'
              ? 'calling…'
              : 'waiting for result…'
            : failed
              ? 'failed'
              : 'done'}
        </span>
      </button>
      {open && (
        <pre className="tool-body">
          {part.input !== undefined && (
            <>
              <div className="tool-label">input</div>
              {highlightText(JSON.stringify(part.input, null, 2), query)}
            </>
          )}
          {part.output !== undefined && (
            <>
              <div className="tool-label">result</div>
              {highlightText(previewOutput(part.output), query)}
            </>
          )}
          {part.errorText && (
            <>
              <div className="tool-label">error</div>
              {highlightText(part.errorText, query)}
            </>
          )}
        </pre>
      )}
    </div>
  );
}

/** Clipboard write with a legacy fallback for non-secure contexts. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function CopyResponseButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      className={`copy-btn ${copied ? 'copy-btn-done' : ''}`}
      aria-label={copied ? 'Copied' : 'Copy response'}
      title={copied ? 'Copied' : 'Copy response'}
      onClick={() => {
        void copyToClipboard(text).then((ok) => {
          if (ok) setCopied(true);
        });
      }}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="8" y="8" width="14" height="14" rx="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
      )}
    </button>
  );
}

function MessageView({ message, query }: { message: UIMessage; query: string }) {
  const isAssistant = message.role === 'assistant';
  // Copyable response text = the raw Markdown of every text part, in order.
  const responseText = isAssistant
    ? message.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { text: string }).text)
        .join('\n\n')
    : '';

  // Search match: any text part, or a tool block's name/state/result preview.
  const q = query.trim().toLowerCase();
  const matches = q.length > 0 && message.parts.some((part) => {
    if (isToolPart(part)) {
      const tp = part as ToolPart;
      return [toolNameOf(tp), tp.state, previewOutput(tp.output)].some((s) => s.toLowerCase().includes(q));
    }
    return part.type === 'text' && (part as { text: string }).text.toLowerCase().includes(q);
  });

  return (
    <div className={`msg-wrap msg-wrap-${message.role} ${matches ? '' : q ? 'msg-dimmed' : ''}`}>
      <div className={`msg msg-${message.role}`}>
        {message.parts.map((part, i) => {
          if (isToolPart(part)) return <ToolBlock key={(part as ToolPart).toolCallId} part={part as ToolPart} query={query} />;
          if (part.type === 'text') {
            const text = (part as { text: string }).text;
            // Assistant text arrives as Markdown → render it. User input stays
            // verbatim plain text (nothing to format, no injection surface).
            return (
              <div key={i} className="msg-text">
                {isAssistant ? (
                  <Markdown text={text} query={query} />
                ) : (
                  <span className="msg-plain">{highlightText(text, query)}</span>
                )}
              </div>
            );
          }
          return null; // reasoning/file/data parts: not rendered in v1
        })}
      </div>
      {isAssistant && responseText ? (
        <div className="msg-actions">
          <CopyResponseButton text={responseText} />
        </div>
      ) : null}
    </div>
  );
}

function SignInBanner({ reason }: { reason?: string }) {
  return (
    <div className="banner">
      <h1>NIPP Portal Agent</h1>
      <p>
        {reason ?? 'Sign in to the portal to chat with the agent.'} The session
        is shared with the NIPP portal — sign in once there and come back.
      </p>
      <a className="btn" href={portalLoginUrl()}>
        Sign in to the portal
      </a>
    </div>
  );
}

/** Modal that prompts for a filename before downloading the chat as .md. */
function SaveChatModal({
  defaultName,
  onClose,
  onSave,
}: {
  defaultName: string;
  onClose: () => void;
  onSave: (filename: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="save-chat-title" className="modal">
        <h2 id="save-chat-title">Save chat as Markdown</h2>
        <p className="muted">The entire conversation is downloaded as a single .md file.</p>
        <label htmlFor="save-chat-filename">File name</label>
        <input
          id="save-chat-filename"
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(sanitizeMarkdownFilename(name));
          }}
        />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={!name.trim()}
            onClick={() => onSave(sanitizeMarkdownFilename(name))}
          >
            Save .md
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' });
  const [input, setInput] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Session check on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/session', { credentials: 'include' });
        if (!res.ok) throw new Error(`session ${res.status}`);
        const data = (await res.json()) as { user: SessionUser };
        if (!cancelled) setAuth({ status: 'signed-in', user: data.user });
      } catch {
        if (!cancelled) setAuth({ status: 'signed-out' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signedIn = auth.status === 'signed-in';

  const chat = useChat<UIMessage>({
    id: signedIn ? auth.user.id : undefined, // per-user thread (DESIGN §5.5.5)
    transport: new DefaultChatTransport({ api: '/api/chat', credentials: 'include' }),
  });

  // 401 / session-expired mid-conversation → re-check and show the banner.
  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/session', { credentials: 'include' });
      if (!res.ok) setAuth({ status: 'signed-out' });
    } catch {
      // network blip — keep current auth state
    }
  }, []);

  useEffect(() => {
    if (chat.status === 'error') void checkSession();
  }, [chat.status, checkSession]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  const busy = chat.status === 'submitted' || chat.status === 'streaming';

  // Search: which messages contain the query (case-insensitive, across text
  // parts and tool-block names/results). Drives dimming of non-matching rows.
  const q = query.trim().toLowerCase();

  // Download the whole conversation as a markdown file (client-side blob).
  const downloadChatMarkdown = useCallback(
    (filename: string) => {
      const name = sanitizeMarkdownFilename(filename);
      const markdown = chatToMarkdown(chat.messages);
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick so the download has claimed the blob.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setSaveOpen(false);
    },
    [chat.messages],
  );

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    void chat.sendMessage({ text });
  };

  if (auth.status === 'checking') {
    return (
      <main className="chat-main">
        <p className="muted">Checking your portal session…</p>
      </main>
    );
  }

  if (!signedIn) {
    const reason =
      chat.error && String((chat.error as { statusCode?: number }).statusCode ?? '') === '401'
        ? 'Your portal session expired — sign in again.'
        : undefined;
    return (
      <main className="chat-main">
        <SignInBanner reason={reason} />
      </main>
    );
  }

  return (
    <main className="chat-main">
      <header className="chat-header">
        <h1>NIPP Portal Agent</h1>
        <div className="chat-search" role="search">
          <label htmlFor="chat-search-input" className="sr-only">
            Search this conversation
          </label>
          <svg
            className="chat-search-icon"
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            id="chat-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this conversation…"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="chat-header-actions">
          <span className="chat-user">{auth.user.name ?? auth.user.email}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setSaveOpen(true)}
          >
            Save as .md
          </button>
        </div>
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {chat.messages.length === 0 && (
          <p className="muted empty">
            Ask the agent about organizations, work orders, users, invoices —
            e.g. “List all organizations.”
          </p>
        )}
        {chat.messages.map((m) => (
          <MessageView key={m.id} message={m} query={query} />
        ))}
      </div>

      {chat.status === 'error' && (
        <p className="error">Something went wrong: {chat.error?.message}</p>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="Ask the portal agent… (Enter to send, Shift+Enter for newline)"
          disabled={busy}
        />
        <button type="submit" className="btn" disabled={busy || !input.trim()}>
          {busy ? 'Working…' : 'Send'}
        </button>
      </form>

      {saveOpen && (
        <SaveChatModal
          defaultName={defaultChatFilename()}
          onClose={() => setSaveOpen(false)}
          onSave={downloadChatMarkdown}
        />
      )}
    </main>
  );
}
