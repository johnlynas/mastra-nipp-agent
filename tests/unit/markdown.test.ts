import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '@/components/markdown';

/** Render the component to static HTML and assert on the produced markup. */
function render(text: string): string {
  return renderToStaticMarkup(React.createElement(Markdown, { text }));
}

describe('Markdown', () => {
  it('renders headings as real elements', () => {
    const html = render('# Title\n\n## Section');
    expect(html).toContain('<h1');
    expect(html).toContain('<h2');
    expect(html).toContain('Title');
  });

  it('renders lists with nesting', () => {
    const html = render('- one\n- two\n  - nested');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html.match(/<li>/g)?.length ?? 0).toBe(3);
  });

  it('renders GFM tables', () => {
    const html = render('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('renders fenced code blocks with a language label', () => {
    const html = render('```typescript\nconst x = 1;\n```');
    expect(html).toContain('<pre class="md-pre">');
    expect(html).toContain('<span class="md-lang">typescript</span>');
    expect(html).toContain('const x = 1;');
  });

  it('renders inline code separately from blocks', () => {
    const html = render('Use `npm run dev` here.');
    expect(html).toContain('<code class="md-inline">npm run dev</code>');
    expect(html).not.toContain('md-pre');
  });

  it('opens links in a new tab with safe rel', () => {
    const html = render('[docs](https://mastra.ai/docs)');
    expect(html).toContain('href="https://mastra.ai/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('escapes raw HTML in the source (no injection)', () => {
    const html = render('<script>alert(1)</script> hello');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('degrades gracefully on partial stream input', () => {
    // Mid-stream: fence opened but not closed.
    const html = render('Intro\n\n```ts\nconst a = ');
    expect(html).toContain('<pre class="md-pre">');
    expect(html).toContain('const a = ');
  });

  it('wraps output in the .md container for CSS scoping', () => {
    const html = render('plain text');
    expect(html.startsWith('<div class="md">')).toBe(true);
  });
});

describe('Markdown search highlighting', () => {
  function renderWithQuery(text: string, query: string): string {
    return renderToStaticMarkup(React.createElement(Markdown, { text, query }));
  }

  it('marks matches in plain paragraphs, case-insensitively', () => {
    const html = renderWithQuery('The work order is overdue.', 'WORK ORDER');
    expect(html).toContain('<mark>work order</mark>');
    expect(html).not.toContain('<mark>The</mark>');
  });

  it('marks matches inside inline code spans', () => {
    const html = renderWithQuery('Run `npm run dev` now.', 'dev');
    expect(html).toContain('<code class="md-inline">npm run <mark>dev</mark></code>');
  });

  it('marks matches inside table cells and headings', () => {
    const html = renderWithQuery('# Orgs\n\n| a | b |\n|---|---|\n| orgs | 2 |', 'orgs');
    expect(html).toContain('<h1><mark>Orgs</mark></h1>');
    expect(html).toContain('<td><mark>orgs</mark></td>');
  });

  it('marks matches inside fenced code blocks', () => {
    const html = renderWithQuery('```ts\nconst total = 42;\n```', 'total');
    expect(html).toContain('const <mark>total</mark> = 42;');
  });

  it('emits no marks when the query is empty or whitespace', () => {
    expect(renderWithQuery('hello world', '')).not.toContain('<mark>');
    expect(renderWithQuery('hello world', '   ')).not.toContain('<mark>');
  });

  it('matches literally — regex metacharacters are not special', () => {
    const html = renderWithQuery('a.b and aXb', 'a.b');
    expect(html).toContain('<mark>a.b</mark>');
    expect(html).not.toContain('<mark>aXb</mark>');
  });
});
