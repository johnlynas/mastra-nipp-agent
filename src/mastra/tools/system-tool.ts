import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/** `system` domain tool — health, audit trail, metrics and notifications. */
const ACTION_MAP: Record<string, string> = {
  health: 'portal_health',
  session_verify: 'portal_session_verify',
  audit_logs: 'system_audit_logs_list',
  cache_metrics: 'system_cache_metrics_list_admin',
  stats: 'system_stats_list',
  log_error: 'system_errors_create',
  payload_encryption_metrics: 'system_payload_encryption_metrics_list',
  list_notifications: 'notif_notifications_list',
  create_notification: 'notif_notifications_create',
  update_notification: 'notif_notifications_update',
  delete_notification: 'notif_notifications_delete',
};

export const systemTool = createTool({
  id: 'system',
  description:
    'System health, audit trail, metrics and notifications. Read actions: health (portal connectivity), session_verify (MCP server identity + org), audit_logs, cache_metrics, stats, payload_encryption_metrics, list_notifications. ' +
    'Write actions: log_error (record an error; requires `message`), create_notification (requires title, message, scope, organizationId), update_notification, delete_notification. Omit orgId to act on the caller\'s active organization.',
  inputSchema: z.object({
    action: z.enum(['health', 'session_verify', 'audit_logs', 'cache_metrics', 'stats', 'log_error', 'payload_encryption_metrics', 'list_notifications', 'create_notification', 'update_notification', 'delete_notification']),
    orgId: z.string().optional(),
    page: z.union([z.string(), z.number()]).optional(),
    pageSize: z.union([z.string(), z.number()]).optional(),
    resourceType: z.string().optional(),
    cacheAction: z.string().optional(), // cache_metrics sub-action — forwarded as `action`
    message: z.string().optional(),
    reset: z.boolean().optional(),
    title: z.string().optional(),
    scope: z.string().optional(),
    organizationId: z.union([z.string(), z.number()]).optional(),
    priority: z.string().optional(),
  }),
  execute: async (input, options) => {
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown system action '${input.action}'.` };
    // The cache_metrics MCP field is named `action`; our schema uses `cacheAction` to
    // avoid clashing with the domain selector. Forward it under the real name.
    const payload = { ...(input as Record<string, unknown>) };
    if (payload.cacheAction !== undefined) {
      payload.action = payload.cacheAction;
      delete payload.cacheAction;
    }
    return callMcpTool(toolId, payload, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
