import { describe, expect, it, vi } from 'vitest';

type DispatchCall = [toolId: string, payload: Record<string, unknown>, opts: object];
const calls: DispatchCall[] = [];
vi.mock('@/mastra/tools/dispatch', () => ({
  callMcpTool: async (toolId: string, payload: Record<string, unknown>, opts: object) => {
    calls.push([toolId, payload, opts]);
    return { success: true, data: {} };
  },
}));

import { orgTool } from '@/mastra/tools/org-tool';

/** Run the tool's execute() and return the most recent dispatch call. */
async function run(input: Record<string, unknown>): Promise<DispatchCall> {
  await (orgTool as { execute: (i: unknown, o?: unknown) => Promise<unknown> }).execute(
    input,
    { requestContext: undefined },
  );
  return calls[calls.length - 1];
}

describe('org tool — target org id normalization', () => {
  it.each([
    ['get', 'orgId'],
    ['update', 'orgId'],
    ['delete', 'orgId'],
  ])('admin %s: `id` is rewritten to `%s` (the endpoint path param)', async (action, target) => {
    calls.length = 0;
    const [toolId, payload] = await run({ action, id: 'org-123' });
    expect(toolId).toBe(action === 'delete' ? 'org_delete' : `org_${action}_admin`);
    expect(payload[target]).toBe('org-123');
    expect(payload.id).toBeUndefined();
  });

  it.each([
    ['set_status', 'org_status_status_admin'],
    ['t_get', 'org_get_dash'],
    ['t_update', 'org_update_dash'],
    ['t_set_status', 'org_status_status_dash'],
  ])('%s: `id` passes through untouched (endpoint path param is {id})', async (action, toolId) => {
    calls.length = 0;
    const [gotToolId, payload] = await run({ action, id: 'org-123' });
    expect(gotToolId).toBe(toolId);
    expect(payload.id).toBe('org-123');
  });

  it('admin get: an explicit `orgId` passes through untouched', async () => {
    calls.length = 0;
    const [toolId, payload] = await run({ action: 'get', orgId: 'org-456' });
    expect(toolId).toBe('org_get_admin');
    expect(payload.orgId).toBe('org-456');
    expect(payload.id).toBeUndefined();
  });

  it('admin get: `orgId` (the endpoint param) wins when both are given', async () => {
    calls.length = 0;
    const [, payload] = await run({ action: 'get', id: 'org-from-id', orgId: 'org-from-orgid' });
    expect(payload.orgId).toBe('org-from-orgid');
    expect(payload.id).toBe('org-from-id'); // untouched — the MCP tool's filter drops it
  });

  it('set_status: `id` stays `id` (status endpoint uses {id}, not {orgId})', async () => {
    calls.length = 0;
    const [toolId, payload] = await run({ action: 'set_status', id: 'org-789', status: 'SUSPENDED' });
    expect(toolId).toBe('org_status_status_admin');
    expect(payload.id).toBe('org-789');
    expect(payload.orgId).toBeUndefined();
  });

  it('list/search/create need no target param — id is not injected', async () => {
    calls.length = 0;
    const [, payload] = await run({ action: 'search', q: 'Bobs' });
    expect(payload.id).toBeUndefined();
    expect(payload.orgId).toBeUndefined();
  });

  it('update: description is forwarded to the MCP tool (admin PATCH accepts it)', async () => {
    calls.length = 0;
    const [, payload] = await run({ action: 'update', id: 'org-123', description: 'new desc' });
    expect(payload.description).toBe('new desc');
  });

  it('unknown action never dispatches', async () => {
    calls.length = 0;
    const result = (await (orgTool as { execute: (i: unknown, o?: unknown) => Promise<unknown> }).execute(
      { action: 'nope' },
      {},
    )) as Record<string, unknown>;
    // Mastra validates the input enum before our execute runs — either way it
    // must not be a success and must not reach the MCP layer.
    expect(result.success).not.toBe(true);
    expect(calls.length).toBe(0);
  });
});
