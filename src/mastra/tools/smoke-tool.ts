import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { portalMcp } from '../mcp/client';
import { loadConfig } from '../config';

/**
 * Normalizes a failed MCP tool call into a user-readable result.
 * The acceptance criterion for Phase 2: when the MCP server is down, the
 * agent gets "Portal MCP server not reachable at …" — never a raw stack trace.
 */
function unreachableResult(cause: unknown): { success: false; error: string } {
  const url = loadConfig().portalMcpUrl;
  const detail = cause instanceof Error ? cause.message : String(cause);
  return {
    success: false,
    error: `Portal MCP server not reachable at ${url}. Is mastra-nipp-mcp running? (${detail})`,
  };
}

/**
 * PHASE 2 SMOKE TOOL (temporary — removed in Phase 5 when the 15 domain tools
 * replace it).
 *
 * Canaries for the whole bridge: agent → MCPClient → MCP server → portal API.
 * Calls `portal_health`, then `portal_session_verify`, and reports both.
 */
export const portalSmokeTool = createTool({
  id: 'portal_smoke',
  description:
    'Check that the NIPP portal is reachable through the MCP bridge. ' +
    'Calls portal_health and portal_session_verify on the live portal. ' +
    'Use when asked to check portal health or verify the connection.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    health: z.unknown().optional(),
    session: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    const tools = await portalMcp.listTools().catch((e) => {
      throw new Error(`listTools failed: ${e instanceof Error ? e.message : String(e)}`);
    });

    // listTools() namespaces as `<server>_<tool>` (DESIGN §5).
    const healthTool = tools['nippPortal_portal_health'];
    const sessionTool = tools['nippPortal_portal_session_verify'];
    if (!healthTool || !sessionTool) {
      return unreachableResult('portal_health / portal_session_verify not found in the MCP tool list');
    }

    // The MCP-discovered tool's execute() wants (input, context); context is
    // optional at runtime — pass undefined. Cast through unknown because the
    // Tool type's execute signature is stricter than what we need here.
    const run = (t: unknown) =>
      (t as { execute?: (i: unknown, c?: unknown) => Promise<unknown> }).execute?.({}, undefined);

    try {
      const health = await run(healthTool);
      const session = await run(sessionTool);
      return { success: true, health, session };
    } catch (e) {
      return unreachableResult(e);
    }
  },
});
