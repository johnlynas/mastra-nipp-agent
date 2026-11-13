# NIPP Data Model Reference

Read this file when you need entity relationships, enum values, or lifecycle details that the main skill doesn't cover. Source of truth: `nipp-0111/documents/data-model/data-model.md` (generated from `prisma/schema.prisma`).

## Entity relationship map

How the key entities link (FK = database-enforced; logical = no FK constraint):

```
Organization (tenant root)
├── Member ─────────────── links User ↔ Organization (unique per pair), built-in role, optional teamId
│   └── MemberRole ─────── links Member ↔ Role (org-scoped roles composed of permissions)
├── Team ── TeamMember ─── groupings within an org; TeamRole grants roles on team join (inheritance)
├── Role ── RolePermission ── Permission (global catalog, key = "resource.action")
├── Units ──────────────── properties: owner, address, rented?, type (HOUSE/APARTMENT/OTHER)
├── WorkOrder ──────────── work lifecycle; openedBy (email), state, quotesDue
│   ├── WorkOrderNote ──── running notes (super-admin managed); embedded in work_orders.get — no list endpoint
│   ├── Quotation ──────── one per (workOrderId, contractorId); price auto-advances WO to QUOTES_IN
│   └── Invoice ────────── strictly 1:1 with WorkOrder; payment completion → FINISHED
├── Calendar ── CalendarEvent ── eventType, rrule (RFC 5545 recurrence), propertyId → Units (logical)
└── AuditLog / NotificationLog / Notification

User (global, BetterAuth-owned) — activeOrganizationId is a logical pointer (no FK): the org a call
    defaults to when orgId is omitted.
Contractors ────────────── GLOBAL shared directory (not per-tenant); referenced by WorkOrder/Quotation/Invoice.
Resource / ResourceRole ── GLOBAL feature catalog gating which features exist.
JobDefinition / JobExecution ── PLATFORM-ORG ONLY (platformOrgId column); approval gate before any run.
```

Primary-key naming gotchas — these tables do NOT use `id`:
- `WorkOrder.workOrderId`, `Quotation.quoteId`, `Invoice.invoiceId`, `Units.unitId`, `Contractors.contractorId`.

## Enum reference

| Enum | Values | Used by | Semantics |
|---|---|---|---|
| `OrgStatus` | PENDING, ACTIVE, SUSPENDED, ARCHIVED | Organization.status | Tenant lifecycle. New orgs start PENDING; platform promotes to ACTIVE. SUSPENDED pauses access; ARCHIVED is end-of-life (data retained). |
| `WorkOrderState` | CREATED, OUT_FOR_QUOTES, QUOTES_IN, CONTRACTOR_ASSIGNED, STARTED, COMPLETE, INVOICED, FINISHED, CLOSED | WorkOrder.state | Work-order lifecycle (state machine below). CLOSED = early closure pre-assignment. |
| `QuotationState` | OPENED, ACCEPTED, REJECTED, CLOSED | Quotation.state | Per-bid state within a work order. |
| `UnitType` | HOUSE, APARTMENT, OTHER | Units.type | Property kind; default APARTMENT. |
| `ContractorType` | PAINTER, ELECTRICIAN, PLUMBER, GAS_ENGINEER, LIFT_MAINTENANCE, GARDENER, ACCOUNTANT, FIRE_ALARMS, SOLICITOR, ROOFER, WINDOW_CLEANER, OTHER | Contractors.type | Trade; OTHER clarified by description. |
| `CalendarEventType` | VIEWING, INSPECTION, MAINTENANCE, LEASE_SIGNING, LEASE_RENEWAL, KEY_EXCHANGE, OTHER | CalendarEvent.eventType | Operational event kinds; default OTHER. |
| `NotificationScope` | GLOBAL, ORG | Notification.scope | Broadcast-to-all vs tenant-targeted. |
| `NotificationPriority` | INFO, WARNING, ERROR, CRITICAL, CALENDAR, JOB | Notification.priority | Ticker behaviour: INFO/WARNING auto-dismiss; CRITICAL/CALENDAR/JOB persist until dismissed. |
| `NotificationStatus` | SENT, FAILED | NotificationLog.status | E-mail delivery outcome. |
| `CalendarRecurrenceFrequency` | DAILY, WEEKLY, MONTHLY, QUARTERLY, SEMI_ANNUALLY, ANNUALLY | (display layer) | Frontend selector; persistence is via the RFC 5545 `rrule` JSON — no recurrence table. |

## Work-order state machine

```
[*] → CREATED
CREATED → OUT_FOR_QUOTES        RFQ sent (quotesDue set)
OUT_FOR_QUOTES → QUOTES_IN      a quote price received
QUOTES_IN → CONTRACTOR_ASSIGNED quotes awarded
CONTRACTOR_ASSIGNED → STARTED   work begins
STARTED → COMPLETE              work done
COMPLETE → INVOICED             invoice raised
INVOICED → FINISHED             payment complete
CREATED → CLOSED                early closure pre-assignment
```

Practical notes:
- `quotesDue` drives an overdue-alarm job; `deadlineAlertAt` is its idempotency marker (fires at most once).
- Recording a quote `price` automatically advances the parent work order to QUOTES_IN.
- Invoice is 1:1 with the work order — there is never more than one invoice per job.
- Work-order notes are super-admin managed and cascade-delete with the work order.

## Job scheduler (platform-only)

- Jobs live in the Platform org only (`platformOrgId`), Bree-backed, with an explicit **approval gate**: no enable/trigger/run before a platform admin approves (`approved`, `approvedBy`, `approvalNote`).
- `JobExecution.status`: PENDING | RUNNING | SUCCEEDED | FAILED | CANCELLED; `trigger`: SCHEDULE | MANUAL.

## Tenancy & isolation (summary)

- Every tenant table carries an org column (`organizationId`; `orgId` on BetterAuth-owned models) — the key both isolation layers use: an application-layer Prisma extension and PostgreSQL RLS policies checked by the database itself.
- 23 tables carry RLS policies; 7 global tables are deliberately exempt (auth infrastructure, feature catalog, shared contractor directory).
- `isPlatformAdmin` (membership in the Platform org) is what lets RLS expose cross-tenant data to admin API calls.
