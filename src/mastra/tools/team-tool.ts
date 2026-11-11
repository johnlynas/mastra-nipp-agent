import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/** `team` domain tool — teams. Platform scope (no orgId) and tenant scope (orgId set). */
const ACTION_MAP: Record<string, string> = {
  list: 'team_teams_list',
  get: 'team_teams_get',
  create: 'team_teams_create',
  update: 'team_teams_update',
  delete: 'team_teams_delete',
  list_members: 'team_teams_members_list',
  t_list: 'team_organizations_teams_list',
  t_get: 'team_organizations_teams_get',
  t_update: 'team_organizations_teams_update',
  t_delete: 'team_organizations_teams_delete',
  t_list_members: 'team_organizations_teams_members_list',
};

export const teamTool = createTool({
  id: 'team',
  description:
    'Manage teams. Platform-scope actions (no orgId): list, get, create, update, delete, list_members. ' +
    'Tenant-scoped actions prefixed t_ (t_list, t_get, t_update, t_delete, t_list_members) — these target the tenant via orgId and use `teamId`. ' +
    'Platform get/update/delete/list_members use `id`. Omit orgId to act on the caller\'s active organization.',
  inputSchema: z.object({
    action: z.enum(['list', 'get', 'create', 'update', 'delete', 'list_members', 't_list', 't_get', 't_update', 't_delete', 't_list_members']),
    orgId: z.string().optional(),
    id: z.string().optional(),
    teamId: z.string().optional(),
    name: z.string().optional(),
    slug: z.string().optional(),
    description: z.string().nullable().optional(),
    organizationId: z.union([z.string(), z.number()]).optional(),
    page: z.union([z.string(), z.number()]).optional(),
    pageSize: z.union([z.string(), z.number()]).optional(),
    search: z.union([z.string(), z.number()]).optional(),
  }),
  execute: async (input, options) => {
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown team action '${input.action}'.` };
    return callMcpTool(toolId, input as Record<string, unknown>, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
