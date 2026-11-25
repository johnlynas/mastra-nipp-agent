# Per-Request User Authorization in the NIPP Portal MCP Server

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Phase docs: `mcp-authz-phase-1-token-propagation.md`, `mcp-authz-phase-2-admin-gating.md`, `mcp-authz-phase-3-audit-hardening.md` (same directory).

**Goal:** Stop every MCP tool call executing through the MCP server's long-lived Platform super-admin session; make each call execute under the calling user's own portal session, with admin-scoped endpoints reachable only by verified platform admins.

**Architecture:** The agent already verifies the caller's portal session on every chat request (shared `BETTER_AUTH_SECRET` + shared PostgreSQL). Phase 1 propagates that user's session token to the MCP server per tool call via a custom client `fetch` hook (`Authorization: Bearer <token>`); the MCP server verifies it with its own thin BetterAuth instance and forwards it downstream instead of its service-account token. Phase 2 adds scope classification + an admin gate in the MCP server (403 for non-admins on `_admin`/`_dash` tools) plus role-filtered tool lists on both sides. Phase 3 adds per-call audit logging and removes the service-account fallback so unauthenticated MCP calls are rejected outright. The portal app's own RBAC/RLS remains the final enforcement layer — this work never weakens it, only removes the admin-identity bypass.

**Tech Stack:** TypeScript, `@mastra/mcp` 2.9 (Streamable HTTP), BetterAuth bearer plugin, Prisma (portal schema), vitest (agent repo) + new vitest setup (MCP repo).

---

## 1. Current state (verified in code)

| Component | File | Behavior today |
|---|---|---|
| MCP server client | `mastra-nipp-mcp/src/mastra/client.ts` | One `PortalClient` instance, hoisted to `globalThis` (`server.ts:22-28`). Signs in once with `PORTAL_EMAIL`/`PORTAL_PASSWORD` (a Platform super-admin) and reuses that bearer token for **every** request. 401 → transparent re-sign-in + retry. |
| MCP tools | `mastra-nipp-mcp/src/mastra/tools/generate.ts:285-308` | Each generated tool's `execute(input)` calls `client.request(method, path, {…})` — no caller identity is read anywhere. |
| Agent → MCP transport | `mastra-nipp-agent/src/mastra/mcp/client.ts` | `MCPClient` with a plain `{ url }` server config — no auth headers, no per-request context. |
| Agent dispatch | `mastra-nipp-agent/src/mastra/tools/dispatch.ts:171-218` | `callMcpTool(toolId, input, { requestContext })` resolves the caller's `activeOrganizationId` from `requestContext.get('mastra__resourceId')` and injects it as default `orgId`. **This is the only per-user signal today — and it is advisory: the portal call still runs as the super-admin.** |
| Agent auth | `mastra-nipp-agent/src/mastra/auth.ts`, `src/app/api/chat/route.ts` | `MastraAuthBetterAuth` + `getPortalSessionUser()` verify the portal session cookie/bearer per request and set `mastra__resourceId` = user id. Ban check, fail-closed on DB error. |
| Portal enforcement | `nipp-0111/lib/authz-route.ts`, `lib/authz.ts` | `requirePermission(userId, orgId, key)` + `isSuperAdmin()` (platform-org membership) + Postgres RLS under the non-owner `nipp_app` role. This layer is correct and stays as the final gate. |

### The vulnerability

```
tenant user ──► agent (verified user session) ──► MCP server ──(super-admin token)──► portal API
                                        ▲ single global PortalClient instance
```

Any signed-in tenant user can drive `user_list_admin`, `org_*_admin`, `user_ban_ban`, etc. through the shared admin identity. The LLM prompt ("don't run admin tools") is not a security boundary (prompt injection). Even the `orgId` defaulting in `dispatch.ts` fails open: omitting it targets the Platform org by default (`client.ts:152`).

### Confused-deputy mechanics to fix

1. **Identity:** downstream calls must carry the caller's session token, not the service account's.
2. **Privilege:** admin-scoped endpoints must be unreachable for callers who are not platform admins — enforced in the MCP server, not the model.
3. **Observability:** every tool call needs a durable audit record of *who* (user id) called *what* with *which scope*.

---

## 2. Target architecture

```
Browser ──cookie/bearer──► /api/chat (agent :3001)
                              │ verifies portal session (shared secret + DB)
                              │ requestContext: mastra__resourceId, mastra__portalSessionToken
                              ▼
                        domain tools → callMcpTool()
                              │ MCPClient custom fetch hook:
                              │   Authorization: Bearer <caller's portal session token>
                              ▼
                    MCP server (:4112)  [Phase 1]
                      verifyCaller(token): BetterAuth getSession + DB (user row, ban,
                      activeOrganizationId, platform-org membership) — cached per token hash
                      │ token → requestContext('mastra__mcpCaller')
                      ▼
                    scope gate        [Phase 2]
                      tool path ∈ /api/admin/* | /api/dashboard/admin/*  AND  !isPlatformAdmin
                        → 403 FORBIDDEN (never reaches portal)
                      tools/list filtered per caller (admin tools hidden from non-admins)
                      ▼
                    PortalClient.request(…, { bearerToken })   [Phase 1]
                      caller token present  → forward it (no service sign-in)
                      no token + legacy mode→ service account (Phase 3 removes this path)
                      ▼
                    Portal API — RBAC/RLS unchanged, final authority
```

### Design decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Propagate the **existing portal session token** (bearer), not OAuth token exchange. | The portal's BetterAuth `bearer()` plugin already accepts these tokens server-to-server; agent and MCP can both verify them with a shared secret + DB (proven pattern in `mastra-nipp-agent/src/mastra/auth.ts`). No new auth system, no IdP changes. Token Exchange is a future option if the portal grows an API-token feature (already noted in `docs/DESIGN.md` §5.5). |
| D2 | MCP server verifies tokens with its **own thin BetterAuth instance** (`better-auth/minimal`, same as agent) + Prisma on the shared DB. | Symmetric with the agent, keeps the MCP server standalone (no call-back to the portal per request), fail-closed on DB error. |
| D3 | Admin detection = **platform-org membership** (mirror of `nipp-0111/lib/authz.ts:verifySuperAdmin`), via `PLATFORM_ORG_ID` env + `Member`/`MemberRole` rows. | Same definition the portal uses for `/api/admin/*`; no new role concept. |
| D4 | **Two tool surfaces by scope, one server**: `_admin`/`_dash` tools hidden from non-admins in `tools/list` **and** rejected with 403 in `tools/call`. | Hiding is UX/context savings for the LLM; the call-time gate is the actual security boundary (a client can always call a tool it wasn't shown). |
| D5 | Keep the service-account sign-in as a **legacy fallback** in Phases 1–2, behind `MCP_ALLOW_SERVICE_FALLBACK` (default on), removed in Phase 3. | Zero-downtime rollout: existing clients (Studio, scripts) keep working until they send tokens; then the admin session stops being reachable by default. |
| D6 | Caller identity is read from **`requestContext`** inside tool `execute(input, context)` — the MCP server builds it per request from the verified token (`@mastra/mcp` passes `requestContext` into `runTool → tool.execute`; see `node_modules/@mastra/mcp/dist/index.js:24772-24780`). | No new transport plumbing; works over Streamable HTTP and stdio alike. |
| D7 | Per-token verification cache (TTL ~60s, keyed by sha256 of token). | A chat turn makes many tool calls with the same token; avoid a DB hit per call. Sessions are short-lived, so a short TTL bounds staleness. |
| D8 | Portal app: **no changes** in any phase. | RBAC/RLS already enforce ownership and permissions per call — requirement 3 is satisfied by existing code; we only verify it in tests. |

### Threat model (what each layer stops)

| Attack | Stopped by |
|---|---|
| Tenant user asks LLM to list all orgs / ban a user | Phase 2 gate: `user_ban_ban` etc. → 403 before portal; tool hidden from the model in Phase 2b |
| Prompt injection makes the model call an admin tool | Same as above — server-side, model-independent |
| Malicious/buggy MCP client calls `tools/call` directly with a tenant token | Same gate + portal RBAC (defense in depth) |
| Client sends **no** token | Phase 1–2: legacy service fallback (documented); Phase 3: 401, no admin session at all |
| Stale/revoked session token | BetterAuth verification is a DB lookup per token (cached ≤60s) + portal rejects expired sessions with 401 |
| Banned user | `verifyCaller` checks `banned`/`banExpires` (same rule as agent's `authorizeUser`) → reject |
| Token leakage in logs | Audit log stores caller **user id**, never the token; MCP framework already strips tokens from persisted request context (`@mastra/mcp` dist index.js:25441-25451) |

---

## 3. Phased rollout summary

Details, code, and test steps live in the phase docs.

| Phase | Scope | Deliverable | Rollback |
|---|---|---|---|
| **1 — Token propagation** | Agent: chat route sets `mastra__portalSessionToken`; dispatch passes it; MCPClient custom `fetch` injects `Authorization`. MCP: `auth.ts` (`verifyCaller` + cache), `PortalClient` per-request token, generated tools read caller from `requestContext`. Legacy fallback stays on. | Every agent-initiated tool call executes as the calling user. Admin calls by non-admins now hit portal RBAC (403) instead of succeeding — **this is the fix for the core vulnerability**, even before Phase 2's explicit gate. | Set `MCP_ALLOW_SERVICE_FALLBACK=1` + revert agent fetch hook; server behavior unchanged. |
| **2 — Admin gating & tool filtering** | MCP: scope classification (`deriveScope` already exists), `assertScope(tool, caller)` → 403; per-caller `tools/list` filter. Agent: role-aware domain-tool allowlist (admin actions hidden from non-admins). | Explicit, model-independent admin boundary on both sides; non-admin LLM never sees admin tools. | Disable gate via `MCP_ENFORCE_SCOPE_GATE=0` (default on) — degrades to Phase 1 behavior. |
| **3 — Audit + hardening** | MCP: pino JSON-lines audit log (`userId, toolId, scope, orgId, status, latencyMs`); remove service fallback (`MCP_ALLOW_SERVICE_FALLBACK` default off → unauthenticated calls 401); update `SECURITY.md` in both repos; portal-side negative tests (tenant token against admin API). | Durable who/what/where record; the super-admin session no longer reachable from MCP by default. | Flip env flag back on. |

### Files that change (all phases)

**mastra-nipp-mcp**
- `src/mastra/auth.ts` — new (Phase 1)
- `src/mastra/client.ts` — per-request token (Phase 1)
- `src/mastra/tools/generate.ts` — caller from context + scope gate hook (Phases 1–2)
- `src/mastra/mcp/server.ts` — per-caller tool list, audit wiring, config flags (Phases 1–3)
- `src/mastra/config.ts` — new env vars (Phases 1–3)
- `package.json` / `vitest.config.ts` — test infra + `better-auth`, prisma deps (Phase 1)
- `SECURITY.md` — threat model update (Phase 3)

**mastra-nipp-agent**
- `src/app/api/chat/route.ts` — set session token in requestContext (Phase 1)
- `src/mastra/tools/dispatch.ts` — carry token through dispatch (Phase 1)
- `src/mastra/mcp/client.ts` — custom fetch hook (Phase 1)
- `src/mastra/tools/index.ts` + per-domain tools — role-filtered action lists (Phase 2)
- `tests/unit/*.test.ts` — new tests alongside existing ones

**nipp-0111** — none (verified: RBAC/RLS already enforce; only negative-test coverage added in Phase 3, run against the docker test stack).

---

## 4. Risks & open questions

| Risk | Mitigation |
|---|---|
| **R1.** MCP server gains a direct DB dependency (Prisma pool + `BETTER_AUTH_SECRET` + `DATABASE_URL`). | Same proven setup as the agent (`mastra-nipp-agent/src/mastra/auth.ts`); fail-closed on DB error; 60s cache limits load. Prisma client generated from the portal schema, copied verbatim (agent's existing approach). |
| **R2.** Session tokens transit in `Authorization` headers between localhost services. | Dev-only today (all three services on one host). Production: same-host deployment behind TLS; token is already the user's session — no new credential type introduced. Documented in Phase 3 SECURITY.md. |
| **R3.** BetterAuth bearer-token verification semantics may differ for server-minted tokens. | Verified by design: agent already runs this exact flow (`bearer()` plugin + `getSession({ headers })` with a portal token, `src/lib/auth-client.ts:51-57`). Phase 1 Task 1 includes a live integration check against the docker test stack before proceeding. |
| **R4.** Existing non-agent MCP clients (Studio, scripts) break when tokens become mandatory. | Phased: fallback stays until Phase 3; `MCP_ALLOW_SERVICE_FALLBACK` can be re-enabled per environment. |
| **R5.** `@mastra/mcp` internals (requestContext into tool execute) are version-pinned behavior. | Pinned to `@mastra/mcp ^2.9.0`; Phase 1 includes a regression test that asserts the token reaches the generated tool's context; upgrade checklist item in SECURITY.md. |
| **R6.** Platform-org membership lookup needs RLS-correct context (portal uses `withPlatformRead`). | MCP/agent are external to the portal's GUC machinery — they query as the non-owner `nipp_app` role with an explicit `organizationId = PLATFORM_ORG_ID` filter on `Member`, which is what makes the row visible under RLS. Phase 1 Task 2 verifies against live DB state (a known platform admin resolves `isPlatformAdmin: true`). |
| **R7.** Token cache staleness after ban/unban (≤60s window). | Acceptable: portal RBAC re-checks on every call, so a banned user is blocked at the portal within one request; document the bound. |

**Open questions (RESOLVED 2026-11-25, phase 3 close-out):**
1. `_dash` gating — **Resolved:** NOT gated in the MCP server. `_admin` (`/api/admin/*`) is gated on platform-admin membership; `_dash` (`/api/dashboard/admin/*`) is left to the portal's `requirePermission`, which enforces org-admin rights per *target* org and returns its own 403. No new MCP logic — the portal stays the authority for dashboard-admin scope (recorded in phase 2 Task 2 + phase 3 SECURITY.md).
2. Audit log destination — **Resolved:** local JSON file first (`MCP_AUDIT_LOG_FILE`, default `./audit/mcp-audit.log`); no portal changes this phase. Portal `AuditLog`-table write is a named follow-up (revisit after one week of local-file review). Size-based rotation also a named follow-up.

---

## 5. Validation strategy (applies to every phase)

1. **Unit** — agent repo: `npm run test` (vitest, existing suite must stay green). MCP repo: new vitest suite (`npm test` added in Phase 1).
2. **Typecheck/build** — both repos: `npm run type-check` / `npm run build`.
3. **Integration smoke** (docker test stack per `nipp-0111/docker-compose.test.yml`, ports from `.env.test`):
   - Tenant user token → tenant tool (`wo_list` with their org) → 200, data scoped to their org.
   - Tenant user token → admin tool (`user_list_admin`) → Phase 1: portal 403; Phase 2: MCP 403 (no portal round-trip — assert via audit log).
   - Platform admin token → `user_list_admin` → 200.
   - No token → legacy fallback works (Phases 1–2); 401 (Phase 3).
   - Banned user token → 401 from MCP server.
4. **Portal negative tests** (Phase 3): tenant session directly against `/api/admin/*` → 403, proving the portal layer independently holds even if MCP is bypassed.
