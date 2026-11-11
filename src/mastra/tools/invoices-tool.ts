import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/** `invoices` domain tool — invoices (1:1 with a work order). */
const ACTION_MAP: Record<string, string> = {
  list: 'invoice_list',
  create: 'invoice_create',
  update: 'invoice_update',
  delete: 'invoice_delete',
};

export const invoicesTool = createTool({
  id: 'invoices',
  description:
    'Manage invoices. Actions: list, create, update, delete; use `id` for update/delete. ' +
    'create requires workOrderId, contractorId, invoiceDate, price, dueDate. Omit orgId to act on the caller\'s active organization.',
  inputSchema: z.object({
    action: z.enum(['list', 'create', 'update', 'delete']),
    orgId: z.string().optional(),
    id: z.string().optional(),
    workOrderId: z.union([z.string(), z.number()]).optional(),
    contractorId: z.union([z.string(), z.number()]).optional(),
    invoiceDate: z.string().optional(),
    price: z.union([z.number(), z.string()]).optional(),
    dueDate: z.string().optional(),
    invoiceLink: z.string().nullable().optional(),
    organizationId: z.union([z.string(), z.number()]).optional(),
    workOrderState: z.string().optional(),
    page: z.union([z.string(), z.number()]).optional(),
    pageSize: z.union([z.string(), z.number()]).optional(),
    search: z.union([z.string(), z.number()]).optional(),
  }),
  execute: async (input, options) => {
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown invoices action '${input.action}'.` };
    return callMcpTool(toolId, input as Record<string, unknown>, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
