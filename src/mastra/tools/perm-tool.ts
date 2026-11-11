import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/** `perm` domain tool — the platform permission catalog. */
const ACTION_MAP: Record<string, string> = {
  list: 'perm_list_admin',
  get: 'perm_get_admin',
  create: 'perm_create_admin',
  update: 'perm_update_admin',
  delete: 'perm_delete_admin',
  search: 'perm_search_list',
};

export const permTool = createTool({
  id: 'perm',
  description:
    'Manage the platform permission catalog (resource.action grants). Actions: list, get, create, update, delete, search. ' +
    'For get/update/delete use `id`. For create/update, set `resource` and `permAction` (the permission\'s action, e.g. "create") — note this is ' +
    'distinct from the domain `action` selector above. Omit orgId to act on the caller\'s active organization.',
  inputSchema: z.object({
    action: z.enum(['list', 'get', 'create', 'update', 'delete', 'search']),
    orgId: z.string().optional(),
    id: z.string().optional(),
    key: z.string().optional(),
    resource: z.union([z.string(), z.number()]).optional(),
    permAction: z.string().optional(),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
    q: z.union([z.string(), z.number()]).optional(),
    limit: z.union([z.string(), z.number()]).optional(),
    page: z.union([z.string(), z.number()]).optional(),
    pageSize: z.union([z.string(), z.number()]).optional(),
    search: z.union([z.string(), z.number()]).optional(),
  }),
  execute: async (input, options) => {
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown perm action '${input.action}'.` };
    // The MCP field is named `action`; our schema uses `permAction` to avoid
    // clashing with the domain `action` selector. Forward it under the real name.
    const payload = { ...(input as Record<string, unknown>) };
    if (payload.permAction !== undefined) {
      payload.action = payload.permAction;
      delete payload.permAction;
    }
    return callMcpTool(toolId, payload, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
