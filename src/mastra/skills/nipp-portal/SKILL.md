---
name: nipp-portal
description: Use when answering questions about, or taking action in, the NIPP property-management portal — tenants/orgs, users, roles, permissions, teams, units, work orders, quotes, invoices, contractors, calendars, jobs, notifications.
---

# NIPP Portal Domain & Query Playbook

## 1. What NIPP is

NIPP is a multi-tenant property-management platform. Each customer organization ("tenant") manages its own properties (units), staff (users, teams, roles), calendars (viewings, inspections, lease signings…), work (work orders → quotations → invoices) and relationships with external contractors from a shared directory. All tenants live in one PostgreSQL database; isolation is enforced by row-level security keyed on the organization id. A special **Platform** organization hosts root-level administration: membership in it is what authorizes cross-tenant admin API calls, and platform-only features (the job scheduler) live there.

This skill tells you how the portal's data fits together and how to chain your 15 domain tools to answer multi-entity questions accurately. For entity relationships, enum values, and lifecycle details not covered here, read `references/data-model.md`.

## 2. The 15 domain tools at a glance

Each tool takes an `action` (an enum) plus optional parameters; the tool's description lists every valid action and its required fields — only use actions that exist, never invent one. All tools accept optional `orgId` (tenant targeting, see §3), `page`, and `pageSize`.

| Tool | Covers | Typical asks |
|---|---|---|
| `org` | Organizations: CRUD, `set_status` (PENDING/ACTIVE/SUSPENDED/ARCHIVED), `search`, members, roles; tenant variants `t_*` | "list tenants", "suspend X", "who's in Test Tenant?" |
| `user` | Users: CRUD, `ban`/`unban`, `invite`, `search`; tenant variants | "find user by email", "ban this user", "invite someone to the org" |
| `role` | Org-scoped roles: CRUD, `list_members`, `list_permissions`, `search` | "what permissions does Manager have?", "who has the Editor role?" |
| `perm` | Global permission catalog (`resource.action` keys): CRUD, `search` | "list all work-order permissions" |
| `team` | Teams within an org: CRUD, members; joining a team inherits its roles | "show the maintenance team", "add Jane to Electricals" |
| `work_orders` | Work orders: CRUD, `transition` (state machine), `add_note`; notes are embedded in `get` — no separate list endpoint | "open work orders for Test Tenant", "move WO-123 to started" |
| `contractors` | Global shared directory of tradespeople: CRUD | "find a plumber", "list electricians" |
| `invoices` | Invoices: list/create/update/delete | "overdue invoices", "total invoiced this month" |
| `quotes` | Quotations within work orders: CRUD, `t_list` | "quotes on this work order", "which quotes are accepted?" |
| `resources` | Global feature catalog (gates which features exist): CRUD, `list_names` | "what features does the platform have?" |
| `units` | Properties per org: CRUD | "how many units?", "list rented apartments" |
| `calendar` | Org calendars + events (viewings, inspections, lease signings…): CRUD for both, `upcoming_events`, `notification_history`; calendar queries work with ISO 8601 dates | "what's on this week's calendar?" |
| `jobs` | Platform-only background job scheduler (Bree) with an approval gate: CRUD, `run`/`dry_run`, `history`, `approvals`; `s_*` variants | "run the nightly sync", "any failed job runs?" |
| `system` | Health, `session_verify`, `audit_logs`, `cache_metrics`, `stats`, notifications | "who changed what last week?", "is the portal healthy?" |
| `security` | Payload encryption keys: `create_payload_key`/`revoke_payload_key` (sensitive) | "rotate the payload key" |


## 3. Tenant scoping: admin vs tenant scope

The portal has two API scopes, and the tools expose both:

- **Admin scope** (`/api/admin/...`): cross-tenant operations over ALL organizations — used by root-level administration. A caller may use admin API calls only if they are a **member of the "Platform" organization**; the portal checks Platform membership before executing any admin call. The MCP server itself acts as a Platform-org admin session, so admin-scope tools work when the signed-in user has that membership.
- **Tenant scope** (`/api/organizations/{orgId}/...`): single-organization data, isolated per tenant by PostgreSQL row-level security (RLS). This is what an organization's own users see and manage for their org.

How to target a tenant:

1. If the user names a tenant ("Test Tenant"), resolve it first with `org.search` (or `org.list`) and pass the returned id as `orgId`. Never guess or fabricate org ids.
2. If no tenant is named, **omit `orgId`** — the system reads the signed-in user's `activeOrganizationId` from their session record and scopes the call to that organization automatically.
3. When `orgId` resolves to nothing, calls default to the Platform org. A "wrong" result may therefore mean you looked at the wrong tenant, not that data is missing — double-check which org a result came from before reporting it.

Choosing admin vs tenant actions:

- Prefer **admin-scope** actions (plain `list`, `get`, `create`, …) for root-level administration across tenants, and when the user asks platform-wide questions ("all suspended orgs", "users in every tenant").
- Use **tenant-scope** actions (`t_list`, `t_get`, `t_create`, … — see each tool's action list) when the question is about one organization's own data, or when RLS isolation must apply.
- Some domains are **global**, not per-tenant: `contractors` (shared directory of tradespeople) and `resources` (the feature/permission catalog). Don't scope these to a tenant.

When an admin-scope call fails with 401/403, the caller likely lacks Platform-org membership — report that plainly; do not retry with altered parameters.

## 4. Cross-tool query workflow

When a question spans more than one tool:

1. **Anchor entity first.** Identify which tool owns the main noun in the question ("work orders" → `work_orders`, "plumbers" → `contractors`) and plan the chain around it.
2. **Resolve names to IDs before anything else.** When a user refers to something by name (tenant, user, team), call its search action first (`org.search`, `user.search`) and use the returned id in every downstream call. Never guess or fabricate UUIDs.
3. **Push filtering server-side.** Use each endpoint's own filter params (`search`, `state`, status fields) instead of fetching everything and filtering in your head.
4. **Joins are manual.** The API doesn't join entities — collect IDs from one tool's result and pass them into the next (e.g., work order → its quotes via the work-order id; user → their roles via member/role lookups).
5. **Paginate responsibly.** `pageSize` 20 by default; fetch further pages only when the user asks for exhaustive totals or exports, and say so when you stop early.
6. **Platform-wide questions cost N+1.** "How many units does each tenant have?" = `org.list`, then one call per tenant — do it, but state how many tenants you checked and summarize in a table.
7. **Summarize, don't dump.** Report counts + key fields; hide raw UUIDs unless the user needs them (ids are fine when they'll act on them).
8. **Partial failure.** If one call in a chain fails, report what succeeded plus the exact error from the failed step — don't silently drop it or retry blindly.


## 5. Few-shot examples

**A. Tenant lookup + filtered list**
"Show me open work orders for Test Tenant."
1. `org.search` `{ search: "Test Tenant" }` → take the org id.
2. `work_orders.list` `{ orgId, state: "STARTED", pageSize: 20 }` (repeat for other non-closed states if the user means "not finished").
3. Summarize: count + description/state per work order.

**B. Cross-entity join (person → roles)**
"What roles does jane@example.com have in Test Tenant?"
1. `org.search` `{ search: "Test Tenant" }` → org id.
2. `user.search` `{ orgId, search: "jane@example.com" }` → user id.
3. `role.list_members` per candidate role (or the member lookup that returns the user's roles) → role names; if asked for detail, `role.list_permissions` for each role.

**C. State transition with confirmation**
"Move the boiler repair work order to started."
1. `work_orders.list` `{ orgId, search: "boiler" }`.
2. If exactly one match: state precisely what you will do — `work_orders.transition` `{ id, to: "STARTED" }` — and ask for confirmation first (destructive/sensitive per agent policy).
3. Execute only after explicit agreement; relay the result verbatim.

**D. Platform-wide N+1**
"How many active units does each tenant have?"
1. `org.list` `{ status: "ACTIVE", pageSize: 50 }`.
2. `units.list` `{ orgId, pageSize: 1 }` per tenant (count from the response).
3. Table: tenant name → unit count; state how many tenants were checked.

**E. Audit question**
"Who changed user settings last week?"
1. `system.audit_logs` with matching filters (`resourceType`, page through recent entries).
2. Group by user + action; summarize the top changes with timestamps.


## 6. Edge cases & fallbacks

1. **Ambiguous name matches.** If a search returns several candidates, ask the user which one they mean before running downstream queries — never pick silently.
2. **Empty results.** State the exact filters applied (org scope, state, date range) so the user knows why nothing matched. Remember §3 point 3: empty can mean the wrong tenant was queried, not that data is missing.
3. **401 / session expired.** The dispatcher already surfaces "Portal session expired" — tell the user to sign in to the portal again; don't loop retries.
4. **403 on admin-scope calls.** Likely missing Platform-org membership (see §3); report it plainly, no parameter-shuffling to bypass.
5. **Tool/action not found** (`MCP tool 'x' not found`). Spec drift between the OpenAPI spec and the live server — report it; don't invent a workaround action.

