import { describe, expect, it, vi } from 'vitest';

/**
 * Phase 1 Task 7: the caller's portal session token must reach the MCP
 * transport fetch hook. The chain is:
 *
 *   chat route → requestContext(mastra__portalSessionToken)
 *     → domain tool execute(input, { requestContext })
 *       → callMcpTool(toolId, input, { requestContext })
 *         → mcpClientTool.execute(input, { requestContext })   ← this test's seam
 *           → @mastra/mcp runs the call in an operation scope (dist: `const
 *             operationContext = context?.requestContext ?? null` →
 *             `operationContextStore.run(...)`)
 *             → transport fetch hook receives it as 3rd arg (MastraFetchLike)
 *               → portalMcpFetch injects Authorization: Bearer <token>
 *
 * The last two hops are @mastra/mcp framework behavior (verified in its dist
 * source); this test pins the seam we own — dispatch must hand the full
 * requestContext to the MCP client tool's execute, not `undefined`.
 */

let capturedExecuteArg: unknown = 'not-called';
vi.mock('@/mastra/mcp/client', () => ({
  portalMcp: {
    listToolsWithErrors: async () => ({
      tools: {
        nippPortal_wo_list: {
          inputSchema: { '~standard': { jsonSchema: { input: () => ({ properties: { orgId: {} } }) } } },
          execute: async (_input: unknown, ctx?: unknown) => {
            capturedExecuteArg = ctx;
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: [] }) }] };
          },
        },
      },
      errors: {},
    }),
  },
}));

// dispatch imports agentPrisma (a live Prisma pool) for orgId defaulting —
// mock it so the test never touches the DB.
vi.mock('@/mastra/auth', () => ({
  agentPrisma: { user: { findUnique: async () => ({ activeOrganizationId: 'org_t1' }) } },
}));

import { callMcpTool, invalidateMcpToolCache } from '@/mastra/tools/dispatch';

describe('dispatch → MCP client tool context (phase 1 task 7)', () => {
  it('passes the requestContext (with the portal session token) to the MCP tool execute', async () => {
    invalidateMcpToolCache();
    capturedExecuteArg = 'not-called';
    const rc = new Map<string, unknown>();
    rc.set('mastra__resourceId', 'u_1');
    rc.set('mastra__portalSessionToken', 'tok-caller-123');

    const result = await callMcpTool('wo_list', {}, {
      requestContext: { get: (k: string) => rc.get(k) },
    });

    expect(result.success).toBe(true);
    const ctx = capturedExecuteArg as { requestContext?: { get: (k: string) => unknown } };
    expect(ctx?.requestContext).toBeDefined();
    expect(ctx.requestContext!.get('mastra__portalSessionToken')).toBe('tok-caller-123');
  });

  it('still works when no requestContext is supplied (legacy path)', async () => {
    invalidateMcpToolCache();
    capturedExecuteArg = 'not-called';
    const result = await callMcpTool('wo_list', {});
    expect(result.success).toBe(true);
    expect(capturedExecuteArg).not.toBe('not-called');
  });
});
