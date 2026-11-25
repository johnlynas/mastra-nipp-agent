/**
 * Admin-scoped MCP tool ids (phase 2 task 5).
 *
 * The authoritative boundary is the MCP server's scope gate (mastra-nipp-mcp,
 * classifyTool(path) === 'admin' → 403 for non-platform-admins). This set is
 * the AGENT-side defense-in-depth: when the chat route has verified the caller
 * is NOT a platform admin, callMcpTool refuses these ids before they reach the
 * MCP transport — the model gets a clean refusal instead of a 403 round-trip.
 *
 * Source of truth: every generated tool whose endpoint lives under /api/admin/*
 * (verified against openapi/openapi.json in mastra-nipp-mcp on 2026-11-24 —
 * the portal guards ALL of these routes with requireSuperAdmin). Keep in sync
 * when the spec changes: tests/unit/admin-tool-ids.test.ts asserts coverage of
 * every id referenced by the domain tools' ACTION_MAPs.
 */

export const ADMIN_TOOL_IDS: ReadonlySet<string> = new Set([
  // user (admin)
  'user_list_admin',
  'user_get_admin',
  'user_create_admin',
  'user_update_admin',
  'user_delete_admin',
  'user_search_list',
  // org (admin)
  'org_list_admin',
  'org_list_list',
  'org_get_admin',
  'org_create_admin',
  'org_update_admin',
  'org_delete_admin',
  'org_status_status_admin',
  'org_settings_settings',
  'org_search_list',
  'org_members_list',
  'org_members_update',
  'org_members_delete',
  'org_members_members',
  'org_roles_list',
  'org_roles_update',
  'org_roles_delete',
  'org_roles_roles',
  'org_permissions_list',
  'org_permissions_permissions',
  // perm (admin)
  'perm_list_admin',
  'perm_get_admin',
  'perm_create_admin',
  'perm_update_admin',
  'perm_delete_admin',
  'perm_search_list',
  'resource_permissions_resources_list',
  // role (admin)
  'role_list_admin',
  'role_get_admin',
  'role_create_admin',
  'role_update_admin',
  'role_delete_admin',
  // work orders + notes (admin)
  'wo_list',
  'wo_get',
  'wo_create',
  'wo_update',
  'wo_delete',
  'wo_transition_transition',
  'wonote_create',
  'wonote_update',
  'wonote_delete',
  // invoices / quotes (admin)
  'invoice_list',
  'invoice_create',
  'invoice_update',
  'invoice_delete',
  'quote_list',
  'quote_create',
  'quote_update',
  'quote_delete',
  // jobs + scripts (admin)
  'job_list',
  'job_get',
  'job_create',
  'job_update',
  'job_delete',
  'job_trigger_trigger',
  'job_dry_run_dry_run',
  'job_history_list',
  'job_approvals_approvals',
  // system (admin)
  'system_audit_logs_list',
  'system_cache_metrics_list_admin',
  'system_system_logs_list',
  'system_payload_encryption_metrics_list',
  // notifications (admin)
  'notif_notifications_list',
  'notif_notifications_create',
  'notif_notifications_update',
  'notif_notifications_delete',
]);

/** True when the raw MCP tool id is admin-scoped (/api/admin/*). */
export function isAdminToolId(toolId: string): boolean {
  return ADMIN_TOOL_IDS.has(toolId);
}
