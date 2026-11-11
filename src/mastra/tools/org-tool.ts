import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/**
 * `org` domain tool — organizations (tenants) + membership/roles.
 * ACTION_MAP copied verbatim from docs/domain-mapping.json (non-null actions).
 */
const ACTION_MAP: Record<string, string> = {
  list: 'org_list_admin',
  get: 'org_get_admin',
  create: 'org_create_admin',
  update: 'org_update_admin',
  delete: 'org_delete',
  set_status: 'org_status_status_admin',
  search: 'org_search_list',
  list_members: 'org_members_list',
  list_roles: 'org_roles_list',
  t_list: 'org_list_dash',
  t_get: 'org_get_dash',
  t_create: 'org_create_dash',
  t_update: 'org_update_dash',
  t_set_status: 'org_status_status_dash',
};

export const orgTool = createTool({
  id: 'org',
  description:
    'Manage organizations (tenants) in the NIPP portal. Admin actions: list, get, create, update, delete, set_status (change status), search, list_members, list_roles. ' +
    'Tenant-scoped variants prefixed t_ (t_list, t_get, t_create, t_update, t_set_status). ' +
    'For most actions `id` is the target org; for t_get/t_update/t_set_status `id` is the tenant org itself. Omit orgId to act on the caller\'s active organization.',
  inputSchema: z.object({
    action: z.enum(['list', 'get', 'create', 'update', 'delete', 'set_status', 'search', 'list_members', 'list_roles', 't_list', 't_get', 't_create', 't_update', 't_set_status']),
    orgId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    slug: z.string().optional(),
    description: z.string().nullable().optional(),
    status: z.string().optional(),
    adminEmail: z.string().optional(),
    q: z.union([z.string(), z.number()]).optional(),
    limit: z.union([z.string(), z.number()]).optional(),
    page: z.union([z.string(), z.number()]).optional(),
    pageSize: z.union([z.string(), z.number()]).optional(),
    search: z.union([z.string(), z.number()]).optional(),
  }),
  execute: async (input, options) => {
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown org action '${input.action}'.` };
    return callMcpTool(toolId, input as Record<string, unknown>, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
