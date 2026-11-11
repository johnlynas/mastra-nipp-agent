import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/** `quotes` domain tool — quotations received on work orders. */
const ACTION_MAP: Record<string, string> = {
  list: 'quote_list',
  create: 'quote_create',
  update: 'quote_update',
  delete: 'quote_delete',
  t_list: 'quote_organizations_quotes_list',
};

export const quotesTool = createTool({
  id: 'quotes',
  description:
    'Manage quotations. Actions: list, create, update, delete (use `id` for update/delete), and tenant-scoped t_list. ' +
    'create requires workOrderId, contractorId, dueDate. Omit orgId to act on the caller\'s active organization.',
  inputSchema: z.object({
    action: z.enum(['list', 'create', 'update', 'delete', 't_list']),
    orgId: z.string().optional(),
    id: z.string().optional(),
    workOrderId: z.union([z.string(), z.number()]).optional(),
    contractorId: z.union([z.string(), z.number()]).optional(),
    dueDate: z.string().optional(),
    price: z.union([z.number(), z.string()]).optional(),
    description: z.string().nullable().optional(),
    quoteLink: z.string().nullable().optional(),
    organizationId: z.union([z.string(), z.number()]).optional(),
    state: z.string().optional(),
    page: z.union([z.string(), z.number()]).optional(),
    pageSize: z.union([z.string(), z.number()]).optional(),
    search: z.union([z.string(), z.number()]).optional(),
  }),
  execute: async (input, options) => {
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown quotes action '${input.action}'.` };
    return callMcpTool(toolId, input as Record<string, unknown>, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
