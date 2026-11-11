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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { portalLoginUrl } from '@/lib/portal-url';

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

function ToolBlock({ part }: { part: ToolPart }) {
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
        <span className="tool-name">{name}</span>
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
              {JSON.stringify(part.input, null, 2)}
            </>
          )}
          {part.output !== undefined && (
            <>
              <div className="tool-label">result</div>
              {previewOutput(part.output)}
            </>
          )}
          {part.errorText && (
            <>
              <div className="tool-label">error</div>
              {part.errorText}
            </>
          )}
        </pre>
      )}
    </div>
  );
}

function MessageView({ message, isStreaming }: { message: UIMessage; isStreaming: boolean }) {
  return (
    <div className={`msg msg-${message.role}`}>
      {message.parts.map((part, i) => {
        if (isToolPart(part)) return <ToolBlock key={(part as ToolPart).toolCallId} part={part as ToolPart} />;
        if (part.type === 'text') {
          const isLast = i === message.parts.length - 1;
          return (
            <p key={i} className="msg-text">
              {part.text}
              {isStreaming && isLast ? <span className="cursor" aria-hidden="true" /> : null}
            </p>
          );
        }
        return null; // reasoning/file/data parts: not rendered in v1
      })}
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

export default function ChatPage() {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' });
  const [input, setInput] = useState('');
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
        <span className="muted">
          {auth.user.name ?? auth.user.email} · thread {auth.user.id.slice(0, 8)}…
        </span>
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {chat.messages.length === 0 && (
          <p className="muted empty">
            Ask the agent about organizations, work orders, users, invoices —
            e.g. “List all organizations.”
          </p>
        )}
        {chat.messages.map((m) => (
          <MessageView key={m.id} message={m} isStreaming={busy} />
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
    </main>
  );
}
