import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/** `units` domain tool — property units. */
const ACTION_MAP: Record<string, string> = {
  list: 'unit_list',
  get: 'unit_get',
  create: 'unit_create',
  update: 'unit_update',
  delete: 'unit_delete',
};

/**
 * KNOWN MCP-SCHEMA GAP (documented, not worked around): the generated MCP tools
 * `unit_create` / `unit_update` expose only `orgId` with `additionalProperties:false`,
 * so body fields (owner, address, postCode, email, phone, rented, type) are filtered
 * out and the portal returns a 400 naming the missing field. The Units model is fully
 * populated (data-model §4.8). MCP-server generation limitation, deferred — list/get/delete work.
 */
export const unitsTool = createTool({
  id: 'units',
  description:
    'Manage property units. Actions: list, get, create, update, delete; use `id` for get/update/delete. ' +
    'NOTE: create/update currently cannot carry body fields through the generated MCP schema — if you need to add/edit a unit, report that limitation rather than retrying.',
  inputSchema: z.object({
    action: z.enum(['list', 'get', 'create', 'update', 'delete']),
    orgId: z.string().optional(),
    id: z.string().optional(),
    // Body fields (grounded in the Units model) — included for completeness; see KNOWN MCP-SCHEMA GAP.
    owner: z.string().optional(),
    address: z.string().optional(),
    postCode: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    rented: z.boolean().optional(),
    type: z.string().optional(),
  }),
  execute: async (input, options) => {
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown units action '${input.action}'.` };
    return callMcpTool(toolId, input as Record<string, unknown>, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
