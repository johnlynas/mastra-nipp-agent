import { MCPClient } from '@mastra/mcp';

/**
 * Shared MCPClient instance (DESIGN §5). Module-level singleton so Next.js
 * hot-reload doesn't open a pile of duplicate connections.
 */
export const portalMcp = new MCPClient({
  id: 'portal-client',
  servers: {
    nippPortal: {
      url: new URL(
        process.env.PORTAL_MCP_URL ?? 'http://localhost:4112/api/mcp/nipp-portal/mcp'
      ),
    },
  },
});
