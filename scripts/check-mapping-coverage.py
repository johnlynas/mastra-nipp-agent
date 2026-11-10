#!/usr/bin/env python3
"""Check (and regenerate) docs/domain-mapping.json against the live MCP tool list.

Usage:
  python3 scripts/check-mapping-coverage.py              # probe localhost:4112, verify coverage
  python3 scripts/check-mapping-coverage.py tools.json   # use a saved tools/list dump instead

Exit code 0 = every MCP tool is covered by the mapping (mapped or explicitly
unmapped) and no mapping entry points at a nonexistent tool. Re-run this after
any portal OpenAPI spec change, before Phase 5 work.
"""
import json
import os
import sys
import urllib.request
from collections import defaultdict

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MCP_URL = "http://localhost:4112/api/mcp/nipp-portal/mcp"


def probe_live_tools(url=MCP_URL):
    """Minimal Streamable HTTP MCP handshake: initialize → tools/list."""
    def post(payload, session_id=None):
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if session_id:
            headers["Mcp-Session-Id"] = session_id
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers)
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read().decode()
            return body, r.headers.get("Mcp-Session-Id")

    def parse(body):
        if body.lstrip().startswith("{"):
            return json.loads(body)
        for line in body.splitlines():
            if line.startswith("data:"):
                return json.loads(line[5:].strip())
        raise ValueError(f"unparseable MCP response: {body[:200]}")

    _, sid = post({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                   "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                              "clientInfo": {"name": "mapping-check", "version": "0"}}})
    post({"jsonrpc": "2.0", "method": "notifications/initialized"}, session_id=sid)
    body, _ = post({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, session_id=sid)
    return parse(body)["result"]["tools"]


if len(sys.argv) > 1:
    tools = json.load(open(sys.argv[1]))
else:
    tools = probe_live_tools()
all_ids = {t['name'] for t in tools}

# action -> list of tool ids (primary first; tenant-scoped variants noted)
DOMAINS = {
    "org": {
        "description": "Manage organizations (tenants) and their membership/roles.",
        "actions": {
            "list":            ["org_list_admin"],
            "get":             ["org_get_admin"],
            "create":          ["org_create_admin"],
            "update":          ["org_update_admin"],
            "delete":          ["org_delete"],
            "set_status":      ["org_status_status_admin"],
            "search":          ["org_search_list"],
            "list_members":    ["org_members_list"],
            "list_roles":      ["org_roles_list"],
            # tenant-scope variants (dashboard admin views) — kept for completeness:
            "t_list":          ["org_list_dash"],
            "t_get":           ["org_get_dash"],
            "t_create":        ["org_create_dash"],
            "t_update":        ["org_update_dash"],
            "t_set_status":    ["org_status_status_dash"],
        },
        "unmapped": {
            "org_list_list":          "GET /api/organizations (public tenant list) — not admin surface",
            "org_members_members":    "GET single member detail — use list_members + client filter",
            "org_members_update":     "PATCH member role — covered by role tool add_member/remove_member flow",
            "org_members_delete":     "DELETE member — v2 (member management via user tool for now)",
            "org_permissions_list":   "GET org permission grants — v2",
            "org_permissions_permissions": "GET single org permission grant — v2",
            "org_roles_roles":        "GET single org role — use list_roles + filter",
            "org_roles_update":       "PATCH org role — v2 (role tool covers platform roles)",
            "org_roles_delete":       "DELETE org role — v2",
            "org_settings_settings":  "GET org settings — v2 read-only detail",
        },
    },
    "user": {
        "description": "Manage portal users: list, create, update, ban/unban, invite.",
        "actions": {
            "list":         ["user_list_admin"],
            "get":          ["user_get_admin"],
            "create":       ["user_create_admin"],
            "update":       ["user_update_admin"],
            "delete":       ["user_delete_admin"],
            "ban":          ["user_ban_ban"],
            "unban":        ["user_update_admin"],  # set banned=false via update
            "invite":       ["user_invite_invite"],
            "search":       ["user_search_list"],
            "t_list":       ["user_list_dash"],
            "t_get":        ["user_get_dash"],
            "t_create":     ["user_create_dash"],
            "t_update":     ["user_update_dash"],
            "t_delete":     ["user_delete_dash"],
        },
        "unmapped": {
            "user_reset_password_reset_password": "Password reset — v2 (security-sensitive, needs HITL)",
        },
    },
    "role": {
        "description": "Manage platform roles and their member/permission assignments.",
        "actions": {
            "list":             ["role_list_admin"],
            "get":              ["role_get_admin"],
            "create":           ["role_create_admin"],
            "update":           ["role_update_admin"],
            "delete":           ["role_delete_admin"],
            "list_members":     ["role_members_list"],
            "list_permissions": ["role_permissions_list"],
            "search":           ["role_search_list"],
        },
        "unmapped": {
            "role_create":                "POST /api/roles (tenant scope) — use org-scoped flow",
            "role_delete":                "DELETE /api/roles/{id} (tenant scope)",
            "role_members_members":       "GET single role member — filter list_members client-side",
            "role_permissions_list_dash": "dashboard variant of list_permissions",
            "role_permissions_permissions": "GET single role permission grant — v2",
            "role_permissions_delete":    "DELETE role permission — use update with permission list (v2)",
            # dashboard-scope variants of the platform role CRUD:
            "role_list_dash":             "dashboard variant of list",
            "role_get_dash":              "dashboard variant of get",
            "role_create_dash":           "dashboard variant of create",
            "role_update_dash":           "dashboard variant of update",
            "role_delete_dash":           "dashboard variant of delete",
            "role_permissions_permissions_dash": "dashboard variant of single-permission detail — v2",
        },
    },
    "perm": {
        "description": "Manage the platform permission catalog.",
        "actions": {
            "list":   ["perm_list_admin"],
            "get":    ["perm_get_admin"],
            "create": ["perm_create_admin"],
            "update": ["perm_update_admin"],
            "delete": ["perm_delete_admin"],
            "search": ["perm_search_list"],
        },
        "unmapped": {
            "perm_list_dash":  "dashboard variant of list",
            "perm_get_dash":   "dashboard variant of get",
            "perm_create_dash": "dashboard variant of create",
            "perm_update_dash": "dashboard variant of update",
            "perm_delete_dash": "dashboard variant of delete",
        },
    },
    "team": {
        "description": "Manage teams. Platform scope (no orgId) and tenant scope (orgId set).",
        "actions": {
            "list":           ["team_teams_list"],
            "get":            ["team_teams_get"],
            "create":         ["team_teams_create"],
            "update":         ["team_teams_update"],
            "delete":         ["team_teams_delete"],
            "list_members":   ["team_teams_members_list"],
            "t_list":         ["team_organizations_teams_list"],
            "t_get":          ["team_organizations_teams_get"],
            "t_create":       None,  # tenant-scope create not exposed — platform only
            "t_update":       ["team_organizations_teams_update"],
            "t_delete":       ["team_organizations_teams_delete"],
            "t_list_members": ["team_organizations_teams_members_list"],
        },
        "unmapped": {
            "team_organizations_teams_members_members": "GET single team member — filter client-side",
            "team_organizations_teams_members_delete":  "DELETE tenant team member — v2",
            "team_organizations_teams_roles_roles":     "GET tenant team roles detail — v2",
            "team_organizations_teams_roles_list":      "list tenant team role grants — v2",
            "team_organizations_teams_roles_delete":    "v2",
            "team_organizations_teams_teams":           "GET single tenant team detail — use t_get (alias of same endpoint)",
            "team_teams_members_members":               "GET single platform team member — filter client-side",
            "team_teams_members_delete":                "DELETE platform team member — v2 (HITL)",
            "team_teams_roles_roles":                   "GET platform team role grants detail — v2",
            "team_teams_roles_list":                    "list platform team role grants — v2",
            "team_teams_roles_delete":                  "v2",
            "tenant_org_organizations_location_list":   "tenant org location view — v2 read-only",
            "tenant_org_organizations_org_chart_list":  "tenant org chart view — v2 read-only",
            "tenant_org_organizations_roles_list":      "tenant roles view — covered by role tool w/ orgId (v2)",
        },
    },
    "work_orders": {
        "description": "Manage work orders: CRUD, state transitions, notes.",
        "actions": {
            "list":       ["wo_list"],
            "get":        ["wo_get"],
            "create":     ["wo_create"],
            "update":     ["wo_update"],
            "delete":     ["wo_delete"],
            "transition": ["wo_transition_transition"],
            "t_list":     ["wo_organizations_work_orders_list"],
            "t_get":      ["wo_organizations_work_orders_get"],
            "add_note":   ["wonote_create"],
        },
        "unmapped": {
            "wonote_update": "PATCH note — v2",
            "wonote_delete": "DELETE note — v2 (HITL)",
            # NOTE: no wonote_list endpoint exists; notes are embedded in wo_get response.
            # Verify during Phase 5 implementation.
        },
    },
    "contractors": {
        "description": "Manage contractors.",
        "actions": {
            "list":   ["contractor_list"],
            "get":    ["contractor_get"],
            "create": ["contractor_create"],
            "update": ["contractor_update"],
            "delete": ["contractor_delete"],
        },
        "unmapped": {},
    },
    "invoices": {
        "description": "Manage invoices.",
        "actions": {
            "list":   ["invoice_list"],
            "create": ["invoice_create"],
            "update": ["invoice_update"],
            "delete": ["invoice_delete"],
        },
        "unmapped": {
            # NOTE: no invoice_get endpoint in spec — single-invoice detail via list + filter.
        },
    },
    "quotes": {
        "description": "Manage quotes.",
        "actions": {
            "list":   ["quote_list"],
            "create": ["quote_create"],
            "update": ["quote_update"],
            "delete": ["quote_delete"],
            "t_list": ["quote_organizations_quotes_list"],
        },
        "unmapped": {},
    },
    "resources": {
        "description": "Manage resources and the resource permission catalog.",
        "actions": {
            "list":   ["resource_list"],
            "get":    ["resource_get"],
            "create": ["resource_create"],
            "update": ["resource_update"],
            "delete": ["resource_delete"],
            "list_names": ["resource_names_list"],
        },
        "unmapped": {
            "resource_permissions_resources_list": "resource permission grants — v2 (perm tool covers catalog)",
        },
    },
    "units": {
        "description": "Manage property units.",
        "actions": {
            "list":   ["unit_list"],
            "get":    ["unit_get"],
            "create": ["unit_create"],
            "update": ["unit_update"],
            "delete": ["unit_delete"],
        },
        "unmapped": {},
    },
    "calendar": {
        "description": "Manage calendars, events and notifications. Tenant-scoped (orgId required).",
        "actions": {
            "list_calendars":      ["calendar_organizations_calendar_list"],
            "get_calendar":        ["calendar_organizations_calendar_get"],
            "create_calendar":     ["calendar_organizations_calendar_calendar"],
            "update_calendar":     ["calendar_organizations_calendar_update"],
            "delete_calendar":     ["calendar_organizations_calendar_delete"],
            "list_events":         ["calevent_organizations_calendar_events_list"],
            "get_event":           ["calevent_organizations_calendar_events_get"],
            "create_event":        ["calevent_organizations_calendar_events_calendar_events"],
            "update_event":        ["calevent_organizations_calendar_events_update"],
            "delete_event":        ["calevent_organizations_calendar_events_delete"],
            "upcoming_events":     ["calevent_organizations_calendar_events_upcoming_list"],
            "notification_history": ["calnotif_organizations_calendar_notifications_history_list"],
        },
        "unmapped": {
            "calnotif_organizations_calendar_notifications_today_list":   "today's notifications — v2",
            "calnotif_organizations_calendar_notifications_send_today_create": "trigger today's send — v2 (HITL)",
        },
    },
    "jobs": {
        "description": "Manage scheduled jobs and scripts: CRUD, trigger, dry-run, history.",
        "actions": {
            "list":     ["job_list"],
            "get":      ["job_get"],
            "create":   ["job_create"],
            "update":   ["job_update"],
            "delete":   ["job_delete"],
            "run":      ["job_trigger_trigger"],
            "dry_run":  ["job_dry_run_dry_run"],
            "history":  ["job_history_list"],
            "approvals":["job_approvals_approvals"],
            "s_list":   ["script_list"],
            "s_get":    ["script_get"],
            "s_create": ["script_create"],
            "s_update": ["script_update"],
            "s_delete": ["script_delete"],
            "s_run":    ["script_trigger_trigger"],
            "s_dry_run":["script_dry_run_dry_run"],
        },
        "unmapped": {},
    },
    "system": {
        "description": "System health, audit trail, metrics and notifications.",
        "actions": {
            "health":      ["portal_health"],
            "session_verify": ["portal_session_verify"],
            "audit_logs":  ["system_audit_logs_list"],
            "cache_metrics": ["system_cache_metrics_list_admin"],
            "stats":       ["system_stats_list"],
            "log_error":   ["system_errors_create"],
            "payload_encryption_metrics": ["system_payload_encryption_metrics_list"],
            "list_notifications": ["notif_notifications_list"],
            "create_notification": ["notif_notifications_create"],
            "update_notification": ["notif_notifications_update"],
            "delete_notification": ["notif_notifications_delete"],
        },
        "unmapped": {
            "system_cache_metrics_list":  "non-admin cache metrics variant",
            "system_system_logs_list":    "system logs — v2",
            "notif_notifications_stream_list": "SSE stream endpoint — not a tool-call surface",
        },
    },
    "security": {
        "description": "Payload encryption key management.",
        "actions": {
            "create_payload_key": ["security_security_payload_key_create"],
            "revoke_payload_key": ["security_security_payload_key_revoke_create"],
        },
        "unmapped": {},
    },
}

# ---- coverage check ----
covered = set()
for d, spec in DOMAINS.items():
    for action, ids in spec["actions"].items():
        if ids:
            covered.update(ids)
    for tid in spec.get("unmapped", {}):
        covered.add(tid)

missing = all_ids - covered
extra = covered - all_ids
print(f"total MCP tools: {len(all_ids)}")
print(f"covered by mapping: {len(covered & all_ids)}")
print(f"MISSING (not in mapping): {sorted(missing) if missing else 'none'}")
print(f"EXTRA (in mapping, not on server): {sorted(extra) if extra else 'none'}")

if missing or extra:
    print("\nCOVERAGE CHECK FAILED — update the DOMAINS table above, then re-run.")
    sys.exit(1)

# no tool claimed by two actions? (aliases like user.unban → user.update_admin are allowed)
ALLOWED_ALIASES = {("user", "unban")}
seen = {}
for d, spec in DOMAINS.items():
    for action, ids in spec["actions"].items():
        for tid in (ids or []):
            if tid in seen and (d, action) not in ALLOWED_ALIASES:
                raise AssertionError(f"dup: {tid} in {d}.{action} and {seen[tid]}")
            seen[tid] = f"{d}.{action}"

out = {"generated": "2026-11-10",
       "source": "live tools/list from nipp-portal MCP server @ localhost:4112 (177 tools)",
       "total_mcp_tools": len(all_ids),
       "domains": DOMAINS}
with open(os.path.join(REPO_ROOT, 'docs', 'domain-mapping.json'), 'w') as f:
    json.dump(out, f, indent=2)
print("wrote docs/domain-mapping.json")
