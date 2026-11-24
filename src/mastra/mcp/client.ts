import { MCPClient } from '@mastra/mcp';
import type { MastraFetchLike } from '@mastra/mcp';
import { RequestContext } from '@mastra/core/request-context';
import { loadConfig } from '../config';

/**
 * Per-request Authorization for the portal MCP transport (phase 1 MCP authz).
 *
 * The chat route puts the caller's verified portal session token in the tool
 * call context under `mastra__portalSessionToken`. @mastra/mcp passes that
 * requestContext to this fetch hook as its 3rd argument on every outbound
 * request (MastraFetchLike), so each MCP request carries the CALLING user's
 * token — the MCP server verifies it and forwards it to the portal under that
 * user's session instead of its own service account.
 *
 * No token (empty/absent) → no Authorization header: the MCP server's legacy
 * service-account fallback handles it (phase 3 removes that path).
 */
export function portalMcpFetch(inner: typeof fetch): MastraFetchLike {
  return async (url, init, requestContext) => {
    const headers = new Headers(init?.headers);
    const token = requestContext?.get('mastra__portalSessionToken');
    if (typeof token === 'string' && token) {
      headers.set('authorization', `Bearer ${token}`);
    }
    return inner(url, { ...init, headers });
  };
}

/**
 * Shared MCPClient instance (DESIGN §5). Module-level singleton so Next.js
 * hot-reload doesn't open a pile of duplicate connections.
 *
 * Note: this @mastra/mcp version exposes no direct `callTool()` — callers use
 * `portalMcp.listTools()` (namespaced `<server>_<tool>`) and invoke the
 * returned tool's `.execute()`. The Phase 5 dispatcher wraps that pattern.
 */
export const portalMcp = new MCPClient({
  id: 'portal-client',
  servers: {
    nippPortal: {
      url: new URL(loadConfig().portalMcpUrl),
      fetch: portalMcpFetch(fetch),
    },
  },
});
