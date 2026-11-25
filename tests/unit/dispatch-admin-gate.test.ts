import { describe, expect, it, vi } from 'vitest';

/**
 * Phase 2 task 5 (agent side): role-aware action dispatch.
 *
 * The MCP server's scope gate is the authoritative boundary; this is the
 * agent-side defense-in-depth: when the chat route has verified the caller is
 * NOT a platform admin (`mastra__callerIsAdmin === false`), callMcpTool must
 * refuse admin-scoped tool ids BEFORE they reach the MCP transport — the model
 * gets a clean refusal message instead of a 403 round-trip.
 *
 * - `mastra__callerIsAdmin === true` (or absent, e.g. non-chat callers) → no
 *   agent-side blocking; the MCP gate + portal RBAC decide.
 */

let executedToolIds: string[] = [];
vi.mock('@/mastra/mcp/client', () => ({
  portalMcp: {
    listToolsWithErrors: async () => ({
      tools: {
        nippPortal_user_list_admin: {
          inputSchema: { '~standard': { jsonSchema: { input: () => ({ properties: { orgId: {} } }) } } },
          execute: async (_i: unknown) => {
            executedToolIds.push('user_list_admin');
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: [] }) }] };
          },
        },
        nippPortal_wo_organizations_work_orders_list: {
          inputSchema: { '~standard': { jsonSchema: { input: () => ({ properties: { orgId: {} } }) } } },
          execute: async (_i: unknown) => {
            executedToolIds.push('wo_organizations_work_orders_list');
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: [] }) }] };
          },
        },
      },
      errors: {},
    }),
  },
}));

vi.mock('@/mastra/auth', () => ({
  agentPrisma: { user: { findUnique: async () => ({ activeOrganizationId: 'org_t1' }) } },
}));

import { callMcpTool, invalidateMcpToolCache } from '@/mastra/tools/dispatch';

function rcWith(isAdmin: boolean | undefined) {
  const m = new Map<string, unknown>();
  m.set('mastra__resourceId', 'u_1');
  if (isAdmin !== undefined) m.set('mastra__callerIsAdmin', isAdmin);
  return { get: (k: string) => m.get(k) };
}

describe('role-aware dispatch (phase 2 task 5)', () => {
  it('blocks admin MCP tool ids for non-admin callers — execute never called', async () => {
    invalidateMcpToolCache();
    executedToolIds = [];
    const result = await callMcpTool('user_list_admin', {}, { requestContext: rcWith(false) });
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/administrator/i);
    expect(executedToolIds).toEqual([]); // never reached the MCP transport
  });

  it('allows tenant-scoped tools for non-admins', async () => {
    invalidateMcpToolCache();
    executedToolIds = [];
    const result = await callMcpTool('wo_organizations_work_orders_list', {}, { requestContext: rcWith(false) });
    expect(result.success).toBe(true);
    expect(executedToolIds).toEqual(['wo_organizations_work_orders_list']);
  });

  it('allows admin tools for admins', async () => {
    invalidateMcpToolCache();
    executedToolIds = [];
    const result = await callMcpTool('user_list_admin', {}, { requestContext: rcWith(true) });
    expect(result.success).toBe(true);
    expect(executedToolIds).toEqual(['user_list_admin']);
  });

  it('absent role flag (non-chat callers) → no agent-side block', async () => {
    invalidateMcpToolCache();
    executedToolIds = [];
    const result = await callMcpTool('user_list_admin', {}, { requestContext: rcWith(undefined) });
    expect(result.success).toBe(true);
    expect(executedToolIds).toEqual(['user_list_admin']);
  });
});
