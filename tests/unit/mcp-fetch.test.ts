import { describe, expect, it } from 'vitest';
import { RequestContext } from '@mastra/core/request-context';

// portalMcpFetch is a pure factory — test it directly without touching the
// shared MCPClient singleton.
import { portalMcpFetch } from '@/mastra/mcp/client';

type InnerCall = [input: URL | RequestInfo, init?: RequestInit];

/** fetch stand-in with call capture. */
function makeInner() {
  const calls: InnerCall[] = [];
  const fn = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push([input, init]);
    return new Response('{}');
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('portalMcpFetch (phase 1 task 8)', () => {
  // Note: this @mastra/core version's RequestContext.set() returns undefined —
  // call it as a statement, not chained.
  const rcWithToken = (token: string) => {
    const rc = new RequestContext();
    rc.set('mastra__portalSessionToken', token);
    return rc;
  };

  it('adds Authorization when the requestContext has a token', async () => {
    const { fn, calls } = makeInner();
    await portalMcpFetch(fn)(new URL('http://mcp.test/mcp'), { method: 'POST' }, rcWithToken('tok-x'));
    expect(calls).toHaveLength(1);
    expect((calls[0][1]!.headers as Headers).get('authorization')).toBe('Bearer tok-x');
  });

  it('sends no Authorization when there is no token (legacy server fallback)', async () => {
    const { fn, calls } = makeInner();
    await portalMcpFetch(fn)(new URL('http://mcp.test/mcp'), { method: 'POST' }, null);
    expect((calls[0][1]!.headers as Headers).get('authorization')).toBeNull();
  });

  it('sends no Authorization when the requestContext has an empty token', async () => {
    const { fn, calls } = makeInner();
    await portalMcpFetch(fn)(new URL('http://mcp.test/mcp'), { method: 'POST' }, rcWithToken(''));
    expect((calls[0][1]!.headers as Headers).get('authorization')).toBeNull();
  });

  it('preserves existing request headers', async () => {
    const { fn, calls } = makeInner();
    await portalMcpFetch(fn)(
      new URL('http://mcp.test/mcp'),
      { method: 'POST', headers: { 'content-type': 'application/json' } },
      rcWithToken('tok-x')
    );
    const headers = calls[0][1]!.headers as Headers;
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer tok-x');
  });
});
