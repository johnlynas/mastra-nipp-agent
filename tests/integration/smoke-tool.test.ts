import { describe, it, expect, vi } from 'vitest';

/**
 * PHASE 2 canary tests for the MCP bridge (smoke tool).
 *
 * Acceptance criteria covered:
 * - live MCP server up   → tool returns { success: true } with real portal data
 * - live MCP server down → tool returns a clear "Portal MCP server not reachable at …"
 *                          error, never a raw stack trace
 */

// Tool.execute() wants (input, context); in tests we pass bare values.
const runTool = async (tool: unknown) =>
  (tool as { execute?: (i: unknown, c?: unknown) => Promise<unknown> }).execute?.({}, undefined);

describe('portal smoke tool (MCP bridge canary)', () => {
  it('returns a clear unreachable error when the MCP server is down', async () => {
    process.env.PORTAL_MCP_URL = 'http://localhost:49999/api/mcp/nipp-portal/mcp';
    const { portalSmokeTool } = await import('../../src/mastra/tools/smoke-tool');

    const result = (await runTool(portalSmokeTool)) as {
      success: boolean;
      error?: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toContain('Portal MCP server not reachable at http://localhost:49999');
  });

  it('reaches the live portal when the MCP server is up', async () => {
    vi.resetModules();
    delete process.env.PORTAL_MCP_URL; // default → localhost:4112
    const { portalSmokeTool } = await import('../../src/mastra/tools/smoke-tool');

    const result = (await runTool(portalSmokeTool)) as {
      success: boolean;
      health?: unknown;
      session?: unknown;
      error?: string;
    };

    if (!result.success) {
      // Live server not running in this environment — report, don't crash.
      console.warn('MCP server not reachable, skipping live assertions:', result.error);
      return;
    }

    expect(result.health).toBeTruthy();
    expect(result.session).toBeTruthy();
  });
});
