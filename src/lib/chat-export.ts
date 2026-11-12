/**
 * Chat → Markdown export (client-side).
 *
 * Serializes the live UIMessage list into a readable markdown transcript:
 * one `## User` / `## Agent` section per message, text parts verbatim, and
 * tool-call parts as quoted status lines plus fenced JSON for input/result.
 */

import type { UIMessage } from 'ai';

/** Tool part shape (ai v7) — the fields we serialize. */
interface ExportToolPart {
  type: string; // `tool-<name>` or 'dynamic-tool'
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function isExportToolPart(part: UIMessage['parts'][number]): boolean {
  const p = part as { type?: string };
  return typeof p.type === 'string' && (p.type.startsWith('tool-') || p.type === 'dynamic-tool');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Serialize one message to a markdown section (heading + parts in order). */
export function messageToMarkdown(message: UIMessage): string {
  const heading = message.role === 'user' ? '## User' : `## ${message.role[0].toUpperCase()}${message.role.slice(1)}`;
  const blocks: string[] = [];

  for (const part of message.parts) {
    if (part.type === 'text') {
      const text = (part as { text: string }).text.trim();
      if (text) blocks.push(text);
    } else if (isExportToolPart(part)) {
      const tp = part as ExportToolPart;
      const name = tp.toolName ?? tp.type.replace(/^tool-/, '');
      const lines: string[] = [`> Tool call: \`${name}\` — ${tp.state ?? 'unknown'}`];
      if (tp.input !== undefined) lines.push('```json', safeJson(tp.input), '```');
      if (tp.output !== undefined) lines.push('```json', safeJson(tp.output), '```');
      if (tp.errorText) lines.push(`**Error:** ${tp.errorText}`);
      blocks.push(lines.join('\n'));
    }
    // reasoning/file/data parts: skipped in v1 (same as the UI)
  }

  return [heading, '', ...blocks].join('\n').trimEnd() + '\n';
}

/** Serialize a whole conversation to a markdown document. */
export function chatToMarkdown(messages: UIMessage[], title = 'NIPP Portal Agent — chat export'): string {
  const header = `# ${title}\n\n> Exported ${new Date().toISOString()}\n`;
  if (messages.length === 0) return `${header}\n_No messages._\n`;
  return `${header}\n${messages.map(messageToMarkdown).join('\n')}`;
}

/**
 * Sanitize a user-provided filename for download: strip path separators and
 * control characters, collapse whitespace, drop leading dots/spaces, and make
 * sure it ends in `.md`. Falls back to `fallback` when nothing usable remains.
 */
export function sanitizeMarkdownFilename(raw: string, fallback = 'chat.md'): string {
  let name = raw
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '');
  if (!name) name = fallback;
  if (!/\.md$/i.test(name)) name += '.md';
  return name;
}

/** Suggested filename: `nipp-chat-YYYY-MM-DD.md` (local date). */
export function defaultChatFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `nipp-chat-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.md`;
}
