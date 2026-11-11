import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/**
 * `user` domain tool — portal users: list, create, update, ban/unban, invite.
 * ACTION_MAP copied verbatim from docs/domain-mapping.json (non-null actions).
 *
 * DEVIATION (grounded in the live MCP schema): the JSON maps `unban` to
 * `user_update_admin`, but that tool's input schema has no `banned` field, so it
 * cannot clear a ban. The only tool that toggles `User.banned` is `user_ban_ban`
 * (props: id, banned, banReason, banExpires). Per the data model + product rule
 * ("only platform-org members can ban/unban"), `unban` is routed through
 * `user_ban_ban` with `banned=false`. See dispatch() below.
 */
const ACTION_MAP: Record<string, string> = {
  list: 'user_list_admin',
  get: 'user_get_admin',
  create: 'user_create_admin',
  update: 'user_update_admin',
  delete: 'user_delete_admin',
  ban: 'user_ban_ban',
  unban: 'user_ban_ban', // see DEVIATION note — user_update_admin cannot set `banned`
  invite: 'user_invite_invite',
  search: 'user_search_list',
  t_list: 'user_list_dash',
  t_get: 'user_get_dash',
  t_create: 'user_create_dash',
  t_update: 'user_update_dash',
  t_delete: 'user_delete_dash',
};

export const userTool = createTool({
  id: 'user',
  description:
    'Manage portal users. Admin actions: list, get, create, update, delete, ban, unban, invite, search. Tenant-scoped variants prefixed t_ (t_list, t_get, t_create, t_update, t_delete). ' +
    'For admin get/update/delete use `userId`; for ban/unban/invite and t_* use `id`. Omit orgId to act on the caller\'s active organization.',
  inputSchema: z.object({
    action: z.enum(['list', 'get', 'create', 'update', 'delete', 'ban', 'unban', 'invite', 'search', 't_list', 't_get', 't_create', 't_update', 't_delete']),
    orgId: z.string().optional(),
    userId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    password: z.string().optional(),
    role: z.union([z.string(), z.number()]).optional(),
    organizationId: z.union([z.string(), z.number()]).optional(),
    teamId: z.union([z.string(), z.number()]).optional(),
    status: z.union([z.string(), z.number()]).optional(),
    banned: z.boolean().optional(),
    banReason: z.string().nullable().optional(),
    banExpires: z.string().nullable().optional(),
    q: z.union([z.string(), z.number()]).optional(),
    limit: z.union([z.string(), z.number()]).optional(),
    page: z.union([z.string(), z.number()]).optional(),
    pageSize: z.union([z.string(), z.number()]).optional(),
    search: z.union([z.string(), z.number()]).optional(),
  }),
  execute: async (input, options) => {
    const rc = options?.requestContext as RequestContextLike | undefined;
    // unban → force banned=false through the ban endpoint (the only tool that writes it).
    if (input.action === 'unban') {
      return callMcpTool('user_ban_ban', { ...input, banned: false }, { requestContext: rc });
    }
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown user action '${input.action}'.` };
    return callMcpTool(toolId, input as Record<string, unknown>, { requestContext: rc });
  },
});
