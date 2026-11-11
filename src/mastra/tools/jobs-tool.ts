import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/** `jobs` domain tool — scheduled jobs and scripts: CRUD, trigger, dry-run, history. */
const ACTION_MAP: Record<string, string> = {
  list: 'job_list',
  get: 'job_get',
  create: 'job_create',
  update: 'job_update',
  delete: 'job_delete',
  run: 'job_trigger_trigger',
  dry_run: 'job_dry_run_dry_run',
  history: 'job_history_list',
  approvals: 'job_approvals_approvals',
  s_list: 'script_list',
  s_get: 'script_get',
  s_create: 'script_create',
  s_update: 'script_update',
  s_delete: 'script_delete',
  s_run: 'script_trigger_trigger',
  s_dry_run: 'script_dry_run_dry_run',
};

export const jobsTool = createTool({
  id: 'jobs',
  description:
    'Manage scheduled platform jobs and scripts. Job actions (use `jobId`): list, get, create, update, delete, run, dry_run, history, approvals (approve/reject a job). ' +
    'Script actions prefixed s_ (use `id`): s_list, s_get, s_create, s_update, s_delete, s_run, s_dry_run. ' +
    'create requires name, handlerKey, scheduleExpr; optional code/timezone/timeoutMs/concurrencyLimit/enabled. Omit orgId to act on the caller\'s active organization.',
  inputSchema: z.object({
    action: z.enum(['list', 'get', 'create', 'update', 'delete', 'run', 'dry_run', 'history', 'approvals', 's_list', 's_get', 's_create', 's_update', 's_delete', 's_run', 's_dry_run']),
    orgId: z.string().optional(),
    jobId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    handlerKey: z.string().optional(),
    scheduleExpr: z.unknown().optional(),
    timezone: z.string().optional(),
    timeoutMs: z.union([z.number(), z.string()]).optional(),
    concurrencyLimit: z.union([z.number(), z.string()]).optional(),
    enabled: z.boolean().optional(),
    approved: z.boolean().optional(),
    code: z.string().optional(),
    input: z.unknown().optional(),
    status: z.string().optional(),
    lastRunStatus: z.string().optional(),
    approvalAction: z.string().optional(), // approvals sub-action (approve/reject) — forwarded as `action`
    note: z.string().optional(),
    limit: z.union([z.string(), z.number()]).optional(),
    page: z.union([z.string(), z.number()]).optional(),
    pageSize: z.union([z.string(), z.number()]).optional(),
    search: z.union([z.string(), z.number()]).optional(),
  }),
  execute: async (input, options) => {
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown jobs action '${input.action}'.` };
    // The approvals MCP field is named `action`; our schema uses `approvalAction` to
    // avoid clashing with the domain selector. Forward it under the real name.
    const payload = { ...(input as Record<string, unknown>) };
    if (payload.approvalAction !== undefined) {
      payload.action = payload.approvalAction;
      delete payload.approvalAction;
    }
    return callMcpTool(toolId, payload, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
