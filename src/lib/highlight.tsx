import type { ReactNode } from 'react';
import type { Element as HastElement, ElementContent, Root, RootContent, Text } from 'hast';

/** Escape regex metacharacters so user queries are matched literally. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive <mark> highlighting for a plain string. */
export function highlightText(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const re = new RegExp(escapeRegExp(q), 'gi');
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<mark key={m.index}>{m[0]}</mark>);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++; // zero-length guard
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * rehype plugin: wrap case-insensitive query matches in every hast text node
 * with a real `<mark>` element. Runs after Markdown is parsed to HTML, so it
 * works uniformly across paragraphs, headings, list items, table cells, links,
 * inline code spans, and fenced code blocks — no source sentinels needed.
 */
export function rehypeHighlight(query: string) {
  const q = query.trim();
  // Closure form (not `[fn, options]`): unified's `.use()` does not pass tuple
  // elements to the factory — it treats them as its own options.
  return () => (tree: Root) => {
    if (!q) return;
    const re = new RegExp(escapeRegExp(q), 'gi');
    // Split one text node into [text, <mark>, text, …] segments.
    const split = (node: Text): RootContent[] => {
      re.lastIndex = 0;
      const out: RootContent[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(node.value)) !== null) {
        if (m.index > last) out.push({ type: 'text', value: node.value.slice(last, m.index) });
        out.push({
          type: 'element',
          tagName: 'mark',
          properties: {},
          children: [{ type: 'text', value: m[0] }],
        });
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++; // zero-length guard
      }
      if (out.length === 0) return [node]; // no match — leave as-is
      if (last < node.value.length) out.push({ type: 'text', value: node.value.slice(last) });
      return out;
    };
    // Pure rebuild (no in-place mutation): a `visit` splice would re-visit the
    // freshly inserted <mark> and nest marks. Elements map to one node; text
    // nodes may expand to several — flatMap flattens exactly that.
    const map = (node: RootContent): ElementContent | ElementContent[] => {
      if (node.type === 'element') {
        const el: HastElement = {
          type: 'element',
          tagName: node.tagName,
          properties: node.properties,
          children: node.children.flatMap(map),
        };
        return el;
      }
      if (node.type === 'text') return split(node) as ElementContent[];
      return [node] as ElementContent[]; // doctype/raw — keep as-is
    };
    tree.children = tree.children.flatMap(map);
  };
}
