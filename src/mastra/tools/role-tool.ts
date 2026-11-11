import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/** `role` domain tool — platform roles + member/permission assignments. */
const ACTION_MAP: Record<string, string> = {
  list: 'role_list_admin',
  get: 'role_get_admin',
  create: 'role_create_admin',
  update: 'role_update_admin',
  delete: 'role_delete_admin',
  list_members: 'role_members_list',
  list_permissions: 'role_permissions_list',
  search: 'role_search_list',
};

export const roleTool = createTool({
  id: 'role',
  description:
    'Manage platform roles and their member/permission assignments. Actions: list, get, create, update, delete, list_members, list_permissions, search. ' +
    'For get/update/delete use `roleId`; for list_members use `id`. Omit orgId to act on the caller\'s active organization.',
  inputSchema: z.object({
    action: z.enum(['list', 'get', 'create', 'update', 'delete', 'list_members', 'list_permissions', 'search']),
    orgId: z.string().optional(),
    roleId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    isDefault: z.union([z.boolean(), z.string(), z.number()]).optional(),
    organizationId: z.union([z.string(), z.number()]).optional(),
    q: z.union([z.string(), z.number()]).optional(),
    limit: z.union([z.string(), z.number()]).optional(),
    page: z.union([z.string(), z.number()]).optional(),
    pageSize: z.union([z.string(), z.number()]).optional(),
    search: z.union([z.string(), z.number()]).optional(),
  }),
  execute: async (input, options) => {
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown role action '${input.action}'.` };
    return callMcpTool(toolId, input as Record<string, unknown>, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
