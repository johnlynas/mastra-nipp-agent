# Organization Lifecycle — Rules & Side Effects

When to read: any org `set_status`, org create/delete, role delete/permission-catalog question, or when an org-status operation fails and you need the legal transition set. Source: `nipp-0111/openspec/changes/super-admin-org-mgmt/specs/organization-management/spec.md`.

## 1. State machine (only these transitions are legal)

```
[*] → PENDING                  creation always lands here
PENDING → ACTIVE               first admin user added AND accepts their invite
ACTIVE → SUSPENDED             super admin suspends
SUSPENDED → ARCHIVED           super admin archives
ACTIVE → ARCHIVED              super admin archives
ARCHIVED → (none)              TERMINAL — no restoration; any status change attempt → 400 Bad Request
```

Notes:
- PENDING → SUSPENDED and PENDING → ARCHIVED are NOT listed as legal transitions in the spec — if a user asks, check the live server's response rather than assuming.
- **Ask for explicit user approval before any `org.set_status` call** — suspension invalidates all member sessions and archival is terminal; never execute a status change without confirmation (matches SKILL.md §5).
- "Suspended" pauses access; it is reversible (→ ARCHIVED is the only exit shown). Archived is end-of-life with data retained.

## 2. Side effects per transition (the API does these for you)

| Event | Automatic side effects |
|---|---|
| Org created | Status = PENDING; `org-bootstrap.ts` hook creates the **7 default roles**; unique `slug` auto-generated from name (plus the bootstrap calendar/teams described in data-model.md §3.2–3.6) |
| First admin accepts invite | PENDING → ACTIVE |
| Suspended | Status = SUSPENDED and **all active sessions for that org's members are invalidated** — expect "session expired" from those users afterwards; it is expected behavior, not a bug to debug |
| Archived | Terminal. Report to the user that archival cannot be undone before executing |

## 3. Who can do what (gating)

- **All org lifecycle mutations require super-admin = verified member of the Platform organization.** Admin routes are guarded by `requireSuperAdmin()`; non-members get **403** — report plainly, don't retry with altered params (matches SKILL.md §3).
- **Organization rows:** a tenant can read its own row; only platform ops create/update/delete an org (prevents self-privilege edits).
- **Global org listing** uses the explicitly unscoped `globalDb` client — all tenants, enforced pagination (default 20/page).
- **Audit-log scoping:** super admin sees entries from ALL organizations; an org admin sees only their own organization's entries. When summarizing audit results, state which scope you queried.

## 4. Role & permission safety rules (enforce in conversation)

- **Default roles are protected:** a role with `isDefault = true` cannot be edited or deleted by org admins → 403. If the user wants to change one, say it's a bootstrapped role and only platform ops can touch the catalog.
- **Role deletion safety check:** deleting a role that is assigned to ≥1 member returns a **warning with the count of affected members**; deletion proceeds only after explicit confirmation. When you find such a role, surface the member count and ask for confirmation before executing — do not delete silently.
- **Permission catalog is global and super-admin-only:** keys follow `resource:action` syntax; org admins get 403 on any catalog add/remove. Custom roles are org-scoped (see data-model.md §3.4).

## 5. Extreme-event notifications (context for "why did I get an email" questions)

- Deleting **>100 records of any type within a 1-hour window** triggers a branded email to all super admins + the affected org's admin.
- Rate-limited: after **5 notifications of the same event type in 24h**, further ones are suppressed until the window expires — so "no alert" can mean rate-limiting, not that nothing happened.
