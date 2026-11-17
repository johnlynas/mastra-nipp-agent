# NIPP Portal Data Model — Detailed Reference

When to read: building create/update payloads, interpreting result fields, planning multi-entity joins, enum/state questions beyond SKILL.md §3. Source of truth: `nipp-0111/documents/data-model/data-model.md` (generated from `prisma/schema.prisma`). 30 models → 30 same-named Postgres tables (no renames); 10 enums; 23 RLS-policied tables + 7 exempt globals. All PKs are `cuid()` strings.

## 1. Invariants & gotchas (check before building queries)

**PK naming — these tables do NOT use `id`:**
`WorkOrder.workOrderId`, `WorkOrderNote.workOrderNoteId`, `Quotation.quoteId`, `Invoice.invoiceId`, `Units.unitId`, `Contractors.contractorId`.

**Logical links (no FK constraint — joins are manual):**
- `User.activeOrganizationId` → `Organization.id`: the org a call defaults to when `orgId` is omitted. Membership truth lives in `Member`.
- `CalendarEvent.propertyId` → `Units.unitId`: nullable, so general events exist without a property.
- `WorkOrder.openedById`, `WorkOrderNote.createdById` → `User.id`: actor integrity only; super admins may open work on behalf of orgs.

**Auto-behaviors (the API does these for you):**
- Recording a `Quotation.price` auto-advances the parent WorkOrder to `QUOTES_IN`.
- Payment completion drives the WorkOrder to `FINISHED`.
- Joining a team grants that team's roles (`TeamRole` inheritance, app-layer bootstrap).
- `quotesDue` overdue-alarm fires at most once per work order (`deadlineAlertAt` idempotency marker).

**Uniqueness constraints that shape results:**
- `Member`: one row per (userId, orgId). `TeamMember`: one per (userId, teamId) — a user can be in several teams.
- `Quotation`: exactly one per (workOrderId, contractorId). `Invoice`: strictly 1:1 with WorkOrder — never more than one invoice per job.
- `Calendar.name` unique per org; `Team.slug` unique per org; `Contractors`/`Resource` names unique globally; `JobDefinition.name` unique per platform org.

**Denormalization is deliberate:** every business table carries its tenant's org column directly (not just via a parent relation) — that single column is the scoping key for both isolation layers.

## 2. Entity map

```
Organization (tenant root; id = value stored in every org column)
├── Member ───────────── User ↔ Organization, unique per pair; built-in role (owner/admin/member); optional teamId
│   └── MemberRole ───── Member ↔ Role (org-scoped roles; permissions = union of all held roles)
├── Team ── TeamMember ─ groupings; TeamRole: joining a team grants its roles (inheritance)
├── Role ── RolePermission ── Permission (GLOBAL catalog, key = "resource.action")
├── Units(unitId) ─────── properties; CalendarEvent.propertyId → Units (logical)
├── WorkOrder(workOrderId) — state machine §4; contractorId null until CONTRACTOR_ASSIGNED
│   ├── WorkOrderNote ─── super-admin managed, cascade with WO; embedded in work_orders.get — no list endpoint
│   ├── Quotation(quoteId) — one per (WO, contractor); price receipt auto-advances WO to QUOTES_IN
│   └── Invoice(invoiceId) — strictly 1:1 with WO; payment completion → FINISHED
├── Calendar ── CalendarEvent — eventType, rrule RFC5545 + exdates, propertyId (logical)
├── Invitation / SentInvitation — pending vs sent invite lifecycle (email, token, role?, teamId?)
└── AuditLog / NotificationLog / Notification — append-only logs; org nullable = platform-level

User (GLOBAL, BetterAuth-owned) — activeOrganizationId is a logical pointer (no FK).
Contractors(contractorId) — GLOBAL shared directory; referenced by WorkOrder/Quotation/Invoice.
Resource / ResourceRole — GLOBAL feature catalog gating which features exist.
JobDefinition / JobExecution — PLATFORM-ORG ONLY (platformOrgId); approval gate before any run.
```

## 3. Models, fields, defaults

Format: `field` type [default] — note. `?` = nullable. Timestamps (`createdAt`/`updatedAt`, `now()`/auto) omitted where unremarkable.

### 3.1 Authentication (GLOBAL, BetterAuth-owned — no org column, no RLS by design)

**User** — the human identity; one row per person across all tenants.
`id` PK · `name` · `email` UK (unique platform-wide — all tenants share one identity space) · `emailVerified` bool [false] · `image?` · `passwordHash?` (null for OIDC-only accounts) · `role` string ["member"] (platform-level role, distinct from per-org roles) · `banned?` bool [false] · `banReason?` · `banExpires?` · `activeOrganizationId?` logical → Organization.id · `oidcVerified` bool [false] (true only after magic-link verification; Google asserts email on sign-up so it can't set this).

**Session** — signed-in session record; cascade-deletes with user.
`id` PK · `token` UK · `expiresAt` · `ipAddress?` · `userAgent?` · `userId` FK→User CASCADE.

**Account** — external credential link, one row per (provider, provider-account). Field names FROZEN to BetterAuth's canonical schema.
`id` PK · `providerId` + `accountId` UK pair · `password?` · `accessToken?`/`accessTokenExpiresAt?`/`refreshToken?`/`refreshTokenExpiresAt?` · `idToken?` · `scope?` · `tokenType?` · `sessionState?` (PKCE) · `userId` FK CASCADE.

**Verification** — transient OTP / OAuth PKCE state; pruned by expiry.
`id` PK · `identifier` indexed · `value` · `expiresAt`.

### 3.2 Tenancy & membership

**Organization** — the tenant root row. RLS per-command: a tenant can read its own row; only platform ops create/update/delete (prevents self-privilege edits).
`id` PK (every org column stores this) · `slug?` UK · `name` · `description?` · `status` OrgStatus [PENDING] · `metadata` Json? · `latitude?`/`longitude?`/`mapZoom?` Float (Map page view; zoom clamped when applied).

**Member** — the multi-tenant junction; every authorization check bottoms out here.
`id` PK · `userId` FK→User CASCADE, UK with orgId · `orgId` FK→Organization CASCADE (BetterAuth naming = `organizationId` on other models) · `role` string ["member"] built-in role for this membership (owner/admin/member) · `teamId?` optional team alignment.

**Invitation / SentInvitation** — invite lifecycle: `Invitation` = pending, mirrored to `SentInvitation` once sent.
Both: `id` PK · `email` indexed (user may not exist yet) · `role?` built-in role granted on acceptance · `token` UK single-use · `expiresAt` · `orgId` FK CASCADE. Invitation only: `teamId?` direct team placement.

### 3.3 Teams

**Team** — sub-organizational grouping.
`id` PK · `name` (≤100 chars app-layer) · `slug?` UK with organizationId (auto-generated from name if omitted; also single-column indexed) · `description?` (≤500) · `organizationId` FK CASCADE.

**TeamMember** — user↔team within one org; a user may join several teams. No `updatedAt` (rows not edited in place).
`id` PK · `teamId` FK CASCADE indexed · `userId` FK CASCADE, UK with teamId · `organizationId` FK CASCADE.

**TeamRole** — role-inheritance glue: joining the team auto-confers this org-scoped role (enforced by app-layer bootstrap; table is the declaration).
`id` PK · `teamId` FK CASCADE, UK with roleId · `roleId` FK→Role CASCADE · `organizationId` FK CASCADE.

### 3.4 RBAC + feature catalog

**Permission** — GLOBAL catalog of everything the platform can do, as `resource:action` keys (e.g. `properties:view`). Read is restricted: a tenant sees only permissions assigned to its own org's roles; full-catalog reads are platform-admin-only. Writes platform-only.
`id` PK · `key` UK canonical identifier · `resource` · `action` · `description?` · `isDefault` bool [true] (bootstrapped vs custom).

**Role** — org-scoped bundle of permissions ("Property Manager"). The sensitive side of RBAC — fully tenant-isolated.
`id` PK · `name` indexed (prefix-searchable) · `description?` · `isDefault` bool [false] · `organizationId` FK CASCADE.

**RolePermission** — which permissions a role carries; org-scoped by contract (org column redundant with Role's but required for single-column isolation).
`id` PK · `roleId` FK CASCADE, UK with permissionId · `permissionId` FK **NoAction** (catalog entries deleted only after all grants removed) · `organizationId` FK CASCADE.

**MemberRole** — which roles a member holds; effective permissions = union of all held roles at authorization time.
`id` PK · `memberId` FK→Member CASCADE, UK with roleId · `roleId` FK CASCADE · `organizationId` FK CASCADE.

**Resource** — GLOBAL feature catalog (feature module names).
`id` PK · `name` UK global · `description?`.

**ResourceRole** — GLOBAL junction Resource↔Role; no org column, RLS-exempt by documented design (the sensitive decision sits on the org-scoped Role side, which is policied; reads go through Role).
`id` PK · `resourceId` FK CASCADE, UK with roleId · `roleId` FK→Role CASCADE.

### 3.5 Audit & notifications

**AuditLog** — append-only security trail of admin actions (org creation, role deletion, permission changes…). **No UPDATE/DELETE policy exists — immutable to the app role.**
`id` PK · `timestamp` [now()] indexed (sort key) · `userId?` no FK (survives user deletion) · `userName?` denormalized snapshot · `action` dotted notation e.g. `organization.created` · `resourceType` indexed e.g. `Organization` · `resourceId?` target row id · `organizationId?` FK SetNull indexed — **NULL = platform-level event** · `ipAddress?`/`userAgent?` · `success` bool [true] (failed attempts logged with false) · `metadata` Json?.

**NotificationLog** — e-mail delivery ledger; append-only like AuditLog.
`id` PK · `timestamp` indexed · `recipientEmail` · `eventType` · `message?` stored copy · `status` NotificationStatus [SENT] (SENT|FAILED) · `organizationId?` SetNull — NULL = platform mail.

**Notification** — in-app notices pushed live over SSE + retained for admin history. Scope gates *live delivery*; super admins see everything historically.
`id` PK · `title` · `message` · `priority` NotificationPriority [INFO] (INFO/WARNING auto-dismiss; CRITICAL/CALENDAR/JOB persist until dismissed) · `scope` NotificationScope [ORG] — GLOBAL rows have NULL org, broadcast to all subscribers · `source?` machine origin e.g. `health-check:database`, `admin:message`, `platform:certs` · `organizationId?` SetNull indexed · `acknowledged` bool [false] (set via RLS-gated UPDATE).

### 3.6 Calendar

**Calendar** — named event container; each org gets one default calendar at bootstrap (app invariant: exactly one per org).
`id` PK · `name` UK with organizationId (duplicates rejected) · `description?` · `color` ["#1B2A4A"] theme default, events may override · `isDefault` bool [false] · `organizationId` FK CASCADE.

**CalendarEvent** — one-day, multi-day (start ≤ end) or recurring event. Dates are **local, timezone-naive** datetimes (v1 design).
`id` PK · `title` · `description?` · `startDate`/`endDate` local naive datetime, indexed with org for range queries · `eventType` CalendarEventType [OTHER] · `color?` per-event override · `calendarId` FK CASCADE · `rrule` Json? RFC 5545 recurrence rule (`RRULE:FREQ=…`) — there is no recurrence table · `exdates` Json ["[]"] excluded dates as `YYYY-MM-DD` strings · `propertyId?` indexed logical → Units.unitId (nullable = general org-wide event) · `organizationId` FK CASCADE.

### 3.7 Units (properties)

**Units** — a physical property; the master record everything else hangs off. Model AND table are plural `Units`.
`unitId` PK (not `id`) · `organizationId` FK CASCADE · `owner` · `address` · `postCode` · `email` · `phone` (owner contact block — all required) · `rented` bool [false] currently let/occupied · `type` UnitType [APARTMENT].

### 3.8 Work-order flow

**WorkOrder** — lifecycle in `state` (§4).
`workOrderId` PK (not `id`) · `description` what work is required and where · `openedBy` email of opener (required) · `openedById?` logical User.id no FK · `contractorId?` FK→Contractors (no cascade), **null until CONTRACTOR_ASSIGNED** · `quotesDue?` indexed with org — RFQ deadline, set when the request goes out, default +7 days configurable at send time, drives the overdue-alarm job · `deadlineAlertAt?` idempotency marker so the alert fires at most once per WO · `state` WorkOrderState [CREATED] indexed with org · `organizationId` FK CASCADE.

**WorkOrderNote** — running notes; super-admin managed; cascade-delete with the work order; embedded in `work_orders.get` (no list endpoint).
`workOrderNoteId` PK · `workOrderId` FK CASCADE indexed · `note` · `createdById?` super-admin User.id no FK · `organizationId` FK CASCADE.

**Quotation** — a contractor's bid; exactly one per (work order, contractor). Financial fields stay null until the quote is actually received.
`quoteId` PK (not `id`) · `workOrderId` FK CASCADE, UK with contractorId · `contractorId` FK→Contractors · `quoteLink?` remote link to quotation document · `description?` breakdown of quoted work · `price` Decimal(12,2)? — **recording a price auto-advances the parent WO to QUOTES_IN** · `dueDate` bid validity deadline · `state` QuotationState [OPENED] · `organizationId` FK CASCADE.

**Invoice** — the final bill; strictly 1:1 with its work order (unique FK).
`invoiceId` PK (not `id`) · `invoiceDate` · `workOrderId` FK **unique (1:1)** · `contractorId` FK→Contractors · `invoiceLink?` remote link to invoice document · `price` Decimal(12,2) required · `dueDate` payment due date · `organizationId` FK CASCADE.

### 3.9 Job scheduler (PLATFORM-ORG ONLY — never in a tenant path)

Strongest-protected tables: verified platform-admin flag AND matching `platformOrgId` required for every operation.

**JobDefinition**
`id` PK · `platformOrgId` UK with name (owner = the Platform organization only, not an app FK column) · `name` unique per platform org · `description?` · `handlerKey` registry key → built-in handler or stored script · `code?` operator-authored source — materialized to a tmp file at exec, loaded by path, **never eval'd** · `scheduleExpr` String JSON: `{"kind":"cron"|"interval"|"oneshot",…}` · `timezone?` IANA (default env `JOB_SCHEDULER_TIMEZONE`) · `timeoutMs?` (default env) · `concurrencyLimit` int [1] overlap policy · `enabled` bool [false] — scheduled runs only when enabled **and** approved · `approved` bool [false] — **approval gate: no enable/trigger/run before a platform admin approves** · `approvedBy?`/`approvedAt?`/`approvalNote?` · `lastRunAt?` idempotency marker + claim gate for overlapping/restart runs · `lastRunStatus?` SUCCEEDED|FAILED|CANCELLED · `createdBy?`.

**JobExecution** — one row per run; cascade-deletes with its definition.
`id` PK · `jobDefinitionId` FK CASCADE indexed with startedAt · `platformOrgId` denormalized, indexed with status · `startedAt` [now()] · `finishedAt?` · `status` PENDING|RUNNING|SUCCEEDED|FAILED|CANCELLED · `trigger` SCHEDULE|MANUAL · `actorId?` the platform admin for manual runs · `error?` · `resultJson` Json? structured run output · `source` always `'job-scheduler:execution'`.

### 3.10 Contractors directory (GLOBAL)

**Contractors** — shared directory of external tradespeople usable by every organization; no org column and RLS-exempt by documented design (SECURITY.md Appendix B). Referenced by WorkOrder/Quotation/Invoice.
`contractorId` PK (not `id`) · `companyName` trading name · `name` contact person · `email` · `phone` · `address` · `postCode` · `type` ContractorType [OTHER] · `description?` (primarily clarifies the trade when type=OTHER; usable by all types).

## 4. Enums (exact values)

| Enum | Values | Used by | Semantics |
|---|---|---|---|
| `WorkOrderState` | CREATED, OUT_FOR_QUOTES, QUOTES_IN, CONTRACTOR_ASSIGNED, STARTED, COMPLETE, INVOICED, FINISHED, CLOSED | WorkOrder.state | Lifecycle (§5). CLOSED = early closure pre-assignment. |
| `QuotationState` | OPENED, ACCEPTED, REJECTED, CLOSED | Quotation.state | Per-bid state within a work order. |
| `OrgStatus` | PENDING, ACTIVE, SUSPENDED, ARCHIVED | Organization.status | New orgs start PENDING; platform promotes to ACTIVE. SUSPENDED pauses access; ARCHIVED is end-of-life (data retained). |
| `UnitType` | HOUSE, APARTMENT, OTHER | Units.type | Default APARTMENT. |
| `ContractorType` | PAINTER, ELECTRICIAN, PLUMBER, GAS_ENGINEER, LIFT_MAINTENANCE, GARDENER, ACCOUNTANT, FIRE_ALARMS, SOLICITOR, ROOFER, WINDOW_CLEANER, OTHER | Contractors.type | OTHER clarified by description. |
| `CalendarEventType` | VIEWING, INSPECTION, MAINTENANCE, LEASE_SIGNING, LEASE_RENEWAL, KEY_EXCHANGE, OTHER | CalendarEvent.eventType | Default OTHER. |
| `NotificationScope` | GLOBAL, ORG | Notification.scope | Broadcast-to-all vs tenant-targeted. |
| `NotificationPriority` | INFO, WARNING, ERROR, CRITICAL, CALENDAR, JOB | Notification.priority | INFO/WARNING auto-dismiss; CRITICAL/CALENDAR/JOB persist until dismissed. CALENDAR = "event due to start" SSE reminders. |
| `NotificationStatus` | SENT, FAILED | NotificationLog.status | E-mail delivery outcome. |
| `CalendarRecurrenceFrequency` | DAILY, WEEKLY, MONTHLY, QUARTERLY, SEMI_ANNUALLY, ANNUALLY | (display layer only) | Frontend selector; persistence is the RFC 5545 `rrule` JSON — no recurrence table. |

## 5. Work-order state machine (only these transitions are legal)

```
[*] → CREATED
CREATED → OUT_FOR_QUOTES        RFQ sent (quotesDue set)
OUT_FOR_QUOTES → QUOTES_IN      a quote price received (auto on Quotation.price)
QUOTES_IN → CONTRACTOR_ASSIGNED quotes awarded (contractorId set)
CONTRACTOR_ASSIGNED → STARTED   work begins
STARTED → COMPLETE              work done
COMPLETE → INVOICED             invoice raised
INVOICED → FINISHED             payment complete
CREATED → CLOSED                early closure pre-assignment
```

## 6. Isolation semantics (agent-relevant)

**Scoping classes:**
- **GLOBAL** (no org column, no tenant data): User, Session, Account, Verification, Resource, ResourceRole, Contractors; Permission is global but a tenant can read only the permissions granted to its own org's roles.
- **TENANT**: everything else — Member/Invitation/SentInvitation (`orgId`), all other business tables (`organizationId`).
- **PLATFORM-ONLY**: JobDefinition, JobExecution (`platformOrgId`).

**How isolation works:** two independent layers express the same single-column predicate (org column = request's verified org): an app-layer Prisma extension that injects the tenant id into every query (fail-closed — a scoped query with no context throws), and Postgres RLS policies on 23 tables as the backstop. Both are drift-guarded in CI.

**What this means for you:**
- A platform admin = a verified **Member of the Platform organization**; that membership authorizes admin-scope API calls and cross-tenant reads. Missing it → 401/403 on admin calls, report plainly.
- Fail-closed everywhere: missing/unverified context yields **empty results or 403**, never foreign rows — so "no data" can mean wrong tenant scope, not absence (see SKILL.md §4).
- AuditLog and NotificationLog are append-only at the DB level — read them for "who changed what"; they cannot be modified through the portal.
- Organization rows: tenants read their own; only platform ops create/update/delete an org.
