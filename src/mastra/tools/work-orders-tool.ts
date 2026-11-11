import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/** `work_orders` domain tool — work orders: CRUD, state transitions, notes. */
const ACTION_MAP: Record<string, string> = {
  list: 'wo_list',
  get: 'wo_get',
  create: 'wo_create',
  update: 'wo_update',
  delete: 'wo_delete',
  transition: 'wo_transition_transition',
  t_list: 'wo_organizations_work_orders_list',
  t_get: 'wo_organizations_work_orders_get',
  add_note: 'wonote_create',
};

export const workOrdersTool = createTool({
  id: 'work_orders',
  description:
    'Manage work orders. Actions: list, get, create, update, delete, transition (move to a new state), add_note, and tenant-scoped t_list / t_get. ' +
    'create requires `description` + `organizationId`; transition requires `id` + `to` (target state) and may take contractorIds/quotesDue/quoteId/paid; ' +
    'add_note requires `workOrderId` + `note`. Notes are embedded in the result of `get` — there is no separate list endpoint. Omit orgId to act on the caller\'s active organization.',
  inputSchema: z.object({
    action: z.enum(['list', 'get', 'create', 'update', 'delete', 'transition', 't_list', 't_get', 'add_note']),
    orgId: z.string().optional(),
    id: z.string().optional(),
    description: z.string().optional(),
    organizationId: z.string().optional(),
    openedBy: z.string().optional(),
    state: z.string().optional(),
    to: z.string().optional(),
    contractorIds: z.array(z.string()).optional(),
    quotesDue: z.string().nullable().optional(),
    quoteId: z.string().optional(),
    paid: z.boolean().optional(),
    workOrderId: z.string().optional(),
    note: z.string().optional(),
    page: z.union([z.string(), z.number()]).optional(),
    pageSize: z.union([z.string(), z.number()]).optional(),
    search: z.union([z.string(), z.number()]).optional(),
  }),
  execute: async (input, options) => {
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown work_orders action '${input.action}'.` };
    return callMcpTool(toolId, input as Record<string, unknown>, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
