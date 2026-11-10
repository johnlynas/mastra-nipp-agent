import { MCPClient } from '@mastra/mcp';
import { loadConfig } from '../config';

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
    },
  },
});
