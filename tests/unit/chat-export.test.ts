import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import {
  chatToMarkdown,
  defaultChatFilename,
  messageToMarkdown,
  sanitizeMarkdownFilename,
} from '@/lib/chat-export';

function textMessage(role: 'user' | 'assistant', text: string): UIMessage {
  return { id: `${role}-1`, role, parts: [{ type: 'text', text }] as UIMessage['parts'] };
}

describe('messageToMarkdown', () => {
  it('renders user and assistant headings', () => {
    expect(messageToMarkdown(textMessage('user', 'hi'))).toContain('## User');
    expect(messageToMarkdown(textMessage('assistant', 'hello'))).toContain('## Assistant');
  });

  it('includes text parts verbatim', () => {
    const md = messageToMarkdown(textMessage('assistant', 'line one\nline two'));
    expect(md).toContain('line one\nline two');
  });

  it('serializes tool parts with name, state and fenced JSON', () => {
    const msg: UIMessage = {
      id: 't1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-list_organizations',
          toolCallId: 'c1',
          state: 'output-available',
          input: { limit: 5 },
          output: [{ id: 'org-1' }],
        } as UIMessage['parts'][number],
      ],
    };
    const md = messageToMarkdown(msg);
    expect(md).toContain('> Tool call: `list_organizations` — output-available');
    expect(md).toContain('```json');
    expect(md).toContain('"limit": 5');
    expect(md).toContain('"org-1"');
  });

  it('includes error text for failed tool calls', () => {
    const msg: UIMessage = {
      id: 't2',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'boom',
          toolCallId: 'c2',
          state: 'output-error',
          errorText: 'kaboom',
        } as UIMessage['parts'][number],
      ],
    };
    expect(messageToMarkdown(msg)).toContain('**Error:** kaboom');
  });

  it('skips empty text parts', () => {
    const msg = textMessage('user', '');
    expect(messageToMarkdown(msg).trim()).toBe('## User');
  });
});

describe('chatToMarkdown', () => {
  it('adds a title header and export timestamp', () => {
    const md = chatToMarkdown([textMessage('user', 'hi')]);
    expect(md).toContain('# NIPP Portal Agent — chat export');
    expect(md).toMatch(/Exported \d{4}-\d{2}-\d{2}T/);
  });

  it('orders messages as given and separates sections', () => {
    const md = chatToMarkdown([textMessage('user', 'q'), textMessage('assistant', 'a')]);
    expect(md.indexOf('## User')).toBeLessThan(md.indexOf('## Assistant'));
  });

  it('handles an empty conversation', () => {
    expect(chatToMarkdown([])).toContain('_No messages._');
  });
});

describe('sanitizeMarkdownFilename', () => {
  it('keeps plain names and appends .md when missing', () => {
    expect(sanitizeMarkdownFilename('my-chat')).toBe('my-chat.md');
    expect(sanitizeMarkdownFilename('my-chat.md')).toBe('my-chat.md');
    expect(sanitizeMarkdownFilename('MY.CHAT.MD')).toBe('MY.CHAT.MD');
  });

  it('strips path separators and control characters', () => {
    expect(sanitizeMarkdownFilename('../../etc/passwd')).toBe('_.._etc_passwd.md');
    expect(sanitizeMarkdownFilename('a\nb/c: d')).toBe('a_b_c_ d.md');
  });

  it('collapses whitespace and drops leading dots/spaces', () => {
    expect(sanitizeMarkdownFilename('  ..hidden   name  ')).toBe('hidden name.md');
  });

  it('falls back when nothing usable remains', () => {
    expect(sanitizeMarkdownFilename('///')).toBe('___.md');
    expect(sanitizeMarkdownFilename('')).toBe('chat.md');
    expect(sanitizeMarkdownFilename('???', 'fallback.md')).toBe('___.md');
  });
});

describe('defaultChatFilename', () => {
  it('uses the local date, zero-padded', () => {
    expect(defaultChatFilename(new Date(2026, 10, 12))).toBe('nipp-chat-2026-11-12.md');
  });
});
