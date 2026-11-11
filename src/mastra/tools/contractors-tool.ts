import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/** `contractors` domain tool — the global shared contractor directory. */
const ACTION_MAP: Record<string, string> = {
  list: 'contractor_list',
  get: 'contractor_get',
  create: 'contractor_create',
  update: 'contractor_update',
  delete: 'contractor_delete',
};

/**
 * KNOWN MCP-SCHEMA GAP (documented, not worked around): the generated MCP tools
 * `contractor_create` / `contractor_update` expose only `orgId` with
 * `additionalProperties:false`, so body fields (companyName, name, email, phone,
 * address, postCode, type, description) are filtered out by the dispatcher and
 * the portal returns a 400 naming the missing field. The directory model itself
 * is fully populated (see data-model §4.11). This is an MCP-server generation
 * limitation, deferred — list/get/delete work normally.
 */
export const contractorsTool = createTool({
  id: 'contractors',
  description:
    'Manage the global shared contractor directory (no tenant scoping — orgId only sets x-org-id context). Actions: list, get, create, update, delete; use `id` for get/update/delete. ' +
    'NOTE: create/update currently cannot carry body fields through the generated MCP schema — if you need to add/edit a contractor, report that limitation rather than retrying.',
  inputSchema: z.object({
    action: z.enum(['list', 'get', 'create', 'update', 'delete']),
    orgId: z.string().optional(),
    id: z.string().optional(),
    // Body fields (grounded in the Contractors model) — included for completeness;
    // see KNOWN MCP-SCHEMA GAP above.
    companyName: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    postCode: z.string().optional(),
    type: z.string().optional(),
    description: z.string().nullable().optional(),
  }),
  execute: async (input, options) => {
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown contractors action '${input.action}'.` };
    return callMcpTool(toolId, input as Record<string, unknown>, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
