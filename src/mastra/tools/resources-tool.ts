import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/** `resources` domain tool — feature catalog + resource permission grants. */
const ACTION_MAP: Record<string, string> = {
  list: 'resource_list',
  get: 'resource_get',
  create: 'resource_create',
  update: 'resource_update',
  delete: 'resource_delete',
  list_names: 'resource_names_list',
};

export const resourcesTool = createTool({
  id: 'resources',
  description:
    'Manage the feature catalog (resources) and their role grants. Actions: list, get, create, update, delete, list_names; use `id` for get/update/delete. ' +
    'create requires `name`; optional roleIds array. Omit orgId to act on the caller\'s active organization.',
  inputSchema: z.object({
    action: z.enum(['list', 'get', 'create', 'update', 'delete', 'list_names']),
    orgId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    roleIds: z.array(z.union([z.string(), z.number()])).optional(),
    page: z.union([z.string(), z.number()]).optional(),
    pageSize: z.union([z.string(), z.number()]).optional(),
    search: z.union([z.string(), z.number()]).optional(),
  }),
  execute: async (input, options) => {
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown resources action '${input.action}'.` };
    return callMcpTool(toolId, input as Record<string, unknown>, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
