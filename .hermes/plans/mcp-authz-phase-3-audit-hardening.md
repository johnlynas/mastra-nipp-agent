# Phase 3 — Audit Logging, Hardening & Docs (MCP authz)

> Companion to `2026-11-23_234507-mcp-per-user-authz.md`. Phases 1–2 fixed identity and privilege; this phase makes the change **observable** (audit), removes the last admin-session escape hatch (service fallback off by default), and documents the new security model.

**Goal:** Every MCP tool call produces a durable audit record of who/what/where/outcome; unauthenticated MCP calls are rejected (401) so the super-admin session is no longer reachable from MCP by default; both repos' `SECURITY.md` describe the enforced model.

**Exit criteria:**
- [x] Audit log line emitted for every tool call: `{ ts, userId|'legacy-service', toolId, scope, orgId, status, latencyMs }`.
- [x] No-token call → 401 (with `MCP_ALLOW_SERVICE_FALLBACK` at its new default `0`); setting the flag to `1` restores legacy behavior.
- [x] Portal negative test: tenant session directly against `/api/admin/users` → 403 (proves portal layer holds independently of MCP).
- [x] `SECURITY.md` updated in both repos; threat-model table from design doc reflected.
- [x] All tests/typecheck/build green in both repos.

**Prereq:** Phase 2 merged, running in dev for at least one full day (audit log reviewed for shape before we make it the record of truth).

---

## Part A — MCP server

### Task 1: Audit logger module ✅ (2026-11-25)

**Run log:** `src/mastra/audit.ts` — pino 9.14 destination stream to `MCP_AUDIT_LOG_FILE ?? ./audit/mcp-audit.log`; whitelist-enforced fields (`ts, userId, toolId, scope, orgId?, status, latencyMs`), unknown fields dropped at the boundary; `__setAuditSinkForTests` seam. `tests/unit/audit.test.ts`: 6 tests PASS (field shape, legacy-service id, secret-dropping, forged-ts override blocked, ordering).

**Objective:** A minimal pino JSON-lines audit logger with a testable seam. No portal-table writes in this phase (design doc open question 2: local file first).

**Files:**
- Modify: `mastra-nipp-mcp/package.json` — add `pino` (^9) + `pino/file` transport config (or plain stream to `process.env.MCP_AUDIT_LOG_FILE ?? './audit/mcp-audit.log'`)
- Create: `mastra-nipp-mcp/src/mastra/audit.ts`
- Test: `mastra-nipp-mcp/tests/unit/audit.test.ts`

**Step 1: Failing tests:**

```ts
it('writes one JSON line per call with the required fields', async () => {
  const lines = await auditToBuffer(); // test seam: logger writing to a memory stream
  logToolCall({ userId: 'u1', toolId: 'user_list_admin', scope: 'admin', orgId: 'org_p', status: 200, latencyMs: 42 });
  expect(lines).toHaveLength(1);
  const rec = JSON.parse(lines[0]);
  expect(rec).toMatchObject({ userId: 'u1', toolId: 'user_list_admin', scope: 'admin', orgId: 'org_p', status: 200, latencyMs: 42 });
  expect(rec.ts).toBeTypeOf('string');
});
it('never logs tokens or full request bodies', () => {
  logToolCall({ userId: 'u1', toolId: 'x', scope: 'single', status: 200, latencyMs: 1, meta: { token: 'SECRET' } });
  expect(lastLine()).not.toContain('SECRET');
});
```

**Step 2:** Run → FAIL. **Step 3: Implement** — `logToolCall(entry: AuditEntry)` with a whitelist of fields (anything else dropped at the boundary, not by convention); file transport appends JSON lines; rotate-by-size is out of scope (YAGNI — note as follow-up). **Step 4:** PASS. Commit: `feat(mcp): audit logger for tool calls`.

---

### Task 2: Wire audit into generated tools + utility tools ✅ (2026-11-25)

**Run log:** `generate.ts` execute wrapper times every call and emits one audit line per outcome — portal status, gate 403, 401 unauthenticated, 500 on throw. Audit identity: verified userId; `'legacy-service'` only when the opt-in service fallback actually ran; `'unverified'` for token-less/failed-verification rejections. `utility.ts` audits `portal_health` / `portal_session_verify` with scope `'system'`. `gate.test.ts` extended: 403 gate rejection → audit line `{ userId: 'u_tenant', status: 403 }`; success → caller userId + 200; no-token → 401, not legacy-service.

**Objective:** Every execute path records a call, including gate rejections and legacy calls.

**Files:**
- Modify: `mastra-nipp-mcp/src/mastra/tools/generate.ts` — wrap the existing execute body: measure `latencyMs`, resolve final `status` (portal status, 403 from gate, 401 from missing caller), call `logToolCall`. Caller id = verified `userId`, or `'legacy-service'` when the service fallback ran.
- Modify: `mastra-nipp-mcp/src/mastra/tools/utility.ts` — same for `portal_health` / `portal_session_verify` (these are diagnostics; log with scope `'system'`).
- Test: extend `tests/unit/gate.test.ts` — assert a 403 gate rejection produces an audit line with `userId` of the tenant and `status: 403`.

**Steps:** failing assertion → implement → pass → commit: `feat(mcp): audit every tool call incl. rejections`.

---

### Task 3: Remove service fallback by default ✅ (2026-11-25)

**Run log:** `config.ts` + `client.ts` + `generate.ts` all flipped to opt-in (`MCP_ALLOW_SERVICE_FALLBACK === '1'`; unset/any other value = off). No-token calls now return 401 with a message naming the flag; failed-verification tokens fail closed on ALL tools (403 admin / 401 non-admin) — never degrade to the service account. `.env.example` documents the new default + `MCP_AUDIT_LOG_FILE`. Phase 1/2 client + caller tests updated for the new default.

**Rollback note:** `MCP_ALLOW_SERVICE_FALLBACK=1` in the environment restores pre-Phase-3 behavior immediately — no redeploy needed beyond env reload.

**Objective:** The super-admin session stops being reachable from MCP unless explicitly opted in.

**Files:**
- Modify: `mastra-nipp-mcp/src/mastra/config.ts` — flip default of `MCP_ALLOW_SERVICE_FALLBACK` to `'0'`.
- Modify: `mastra-nipp-mcp/src/mastra/client.ts` — the Phase 1 throw path already exists; extend the message to name the flag.
- Modify: `mastra-nipp-mcp/.env.example` (create if absent) — document `MCP_ALLOW_SERVICE_FALLBACK=0` default, `PLATFORM_ORG_ID`, `DATABASE_URL`, `BETTER_AUTH_SECRET`.
- Test: update Phase 1 client tests' expectations for the new default (no-token → reject by default; flag `1` → legacy).

**Steps:** failing test (new default) → implement → pass → commit: `feat(mcp): service-account fallback off by default`.

**Rollback note:** `MCP_ALLOW_SERVICE_FALLBACK=1` in the environment restores pre-Phase-3 behavior immediately — no redeploy needed beyond env reload.

---

### Task 4: Version-pin regression guard ✅ (2026-11-25)

**Run log:** `tests/integration/context-propagation.test.ts` — boots the REAL production stack in-process (`createHonoServer(mastra)` from @mastra/deployer + the real portalMcpServer) and drives it with the REAL MCPClient over a custom fetch that injects an Authorization header. A diagnostic `context_canary` tool (SHA-256 fingerprint only — never the raw token) proves the wire token reaches the tool execute context AND resolves to the verified caller id. PASS today (green-by-construction). SECURITY.md "Framework upgrade checklist" added: run this test before bumping @mastra/mcp, @mastra/core, @mastra/server, mastra.

**Objective:** The whole design leans on `@mastra/mcp` passing per-request context into tool execute (design doc R5). Make breakage loud.

**Files:**
- Create: `mastra-nipp-mcp/tests/integration/context-propagation.test.ts` — spins the real `MCPServer` in-process (or via `mastra dev` on a test port), issues one `tools/call` with an `Authorization` header, asserts the tool's execute observed the token. Mark `testTimeout(30_000)`.
- Modify: `mastra-nipp-mcp/SECURITY.md` — add "Framework upgrade checklist": run this test before bumping `@mastra/mcp`; it is the canary for requestContext/authInfo plumbing.

**Steps:** implement (no RED needed — green-by-construction regression) → run once to prove it passes today → commit: `test(mcp): context propagation canary`.

---

## Part B — Portal (nipp-0111) — verification only, no code changes

### Task 5: Portal negative tests (defense-in-depth proof) ✅ (2026-11-25)

**Run log:** `nipp-0111/tests/integration/admin-api-negative.test.ts` — drives the REAL route handlers in-process (no requireSuperAdmin/RLS mocks) with self-contained seeded fixtures (known passwords, no platform membership) + the live Platform super-admin for the control. Run against the docker test stack (`set -a; source .env.test; set +a; npx vitest run tests/integration/admin-api-negative.test.ts`) → **3/3 PASS**:
- tenant session → `GET /api/admin/users` → **403** (log: "User is not a member of the platform organization"; no user list returned)
- tenant session → `POST /api/dashboard/admin/users/{seededId}/ban` → **403** (non-2xx, no crash; targets a seeded row so no real account is mutated)
- platform admin session → `GET /api/admin/users` → **200** (control; 8 users returned)

Proves the portal RBAC/RLS independently rejects unauthorized admin calls even with MCP bypassed — requirement 3. No case returned 2xx, so no portal RBAC hole found.

**Objective:** Prove the portal rejects unauthorized admin calls even when MCP is bypassed entirely — requirement 3 of the original ask ("enforce scope checks in the app server").

**Files:**
- Create: `nipp-0111/tests/integration/admin-api-negative.test.ts` (or extend the existing isolation-test harness per `ISOLATION_TEST_STRATEGY.md`) — run against the docker test stack with ports sourced from `.env.test` (`set -a; source .env.test; set +a`):
  1. Sign in as a tenant user (credentials from the seed data).
  2. `GET /api/admin/users` with their bearer token → expect **403** (or 401) — record actual status.
  3. `POST /api/admin/users/{id}/ban`-style mutation → expect non-2xx.
  4. Sign in as platform admin → same GET → 200 (control).

**Steps:** write test → run against stack → record statuses in this file's run log → commit: `test(portal): negative admin-API authz tests`.

If any case returns 2xx, **stop** — that is a portal RBAC hole and becomes the top-priority follow-up (do not paper over it in MCP).

---

## Part C — Docs & final validation

### Task 6: SECURITY.md updates (both repos) ✅ (2026-11-25)

**Run log:** `mastra-nipp-mcp/SECURITY.md` — new "Per-request user authorization (phase 1–3)" section: 7-step architecture flow table, gate semantics (_admin/_dash/_tenant), legacy-fallback flag (off by default), audit log format + location + identity vocabulary, framework upgrade checklist (R5), threat-model table. `mastra-nipp-agent/SECURITY.md` — mirror section: what the agent guarantees (per-request session verify, token never from body, per-request transport auth, role-filtered dispatch) and what it delegates (MCP gate/audit, portal RBAC/RLS). `server.ts` instructions updated to state no-token = 401 default. Reviewed against the design-doc threat-model table — every row has a named enforcement layer.

**Files:**
- Modify: `mastra-nipp-mcp/SECURITY.md` — new section "Per-request user authorization": architecture flow table (login → agent init → tool call), token propagation path, gate semantics, legacy-fallback flag, audit log location/format, framework upgrade checklist.
- Modify: `mastra-nipp-agent/SECURITY.md` — mirror: what the agent guarantees (session verified per request, token never from client body, role-filtered dispatch) and what it delegates to MCP/portal.
- Modify: `mastra-nipp-mcp/src/mastra/mcp/server.ts` instructions if Phase 2 wording needs a "no legacy by default" sentence.

**Steps:** draft → review against design doc threat-model table (every row has a named enforcement layer) → commit: `docs: per-request authz security model`.

### Task 7: Full validation pass + close-out ✅ (2026-11-25)

**Run log:**
1. **mastra-nipp-mcp:** `npx vitest run` → **9 files / 50 tests PASS** (incl. new audit, canary, updated gate/client/config/caller suites); `npm run type-check` → clean; `npm run build` → "Build successful".
2. **mastra-nipp-agent:** `npm run test` → **9 files / 60 tests PASS**; `npm run typecheck` → clean. (No agent code changed in phase 3 beyond a doc comment in mcp/client.ts.)
3. **nipp-0111 (portal):** `tests/integration/admin-api-negative.test.ts` → **3/3 PASS** against the docker test stack; `npm run type-check` → clean.
4. **Live end-to-end smoke** (real production server via `createHonoServer(mastra)`, in-process — portal :3000 was down so the admin-token case surfaced a portal 500, which is itself proof it passed auth+gate and reached the portal):
   - no token → `user_list_admin` → **401** (new default; no portal round-trip), audit: `{"userId":"unverified","toolId":"user_list_admin","scope":"admin","status":401,"latencyMs":0}`
   - admin token → `user_list_admin` → passed auth + scope gate, reached portal (down) → 500, audit: `{"userId":"u_admin","toolId":"user_list_admin","scope":"admin","status":500,"latencyMs":10}`
   - sample audit line shape (real, token redacted by construction): `{"ts":"2026-11-25T13:55:42.837Z","userId":"u_probe1795536867","toolId":"user_list_admin","scope":"admin","orgId":"cmw45w4ab0000p9p9bklk2et2","status":403,"latencyMs":2}`
5. **Design-doc open questions resolved in writing:** (1) `_dash` gating — NOT gated in MCP; portal `requirePermission` is the authority per target org (recorded in phase 2 Task 2 + this doc). (2) Audit destination — local JSON file first (`MCP_AUDIT_LOG_FILE`, default `./audit/mcp-audit.log`); portal `AuditLog`-table write logged as a follow-up.
6. **Commits:** MCP `dfeb71c` (audit + fallback-off, tasks 1–3) and `e0385d6` (canary + security model); portal `96bf1b1` (negative tests); agent SECURITY.md + this plan (close-out).

**Follow-ups (named, not this phase):** audit-file size-based rotation; portal `AuditLog`-table writes; re-enable the no-token legacy path per-environment only via `MCP_ALLOW_SERVICE_FALLBACK=1`.

---

## Phase 3 risks / watch-outs

- **Audit completeness > audit beauty:** a call that executes without an audit line is a silent gap — the Task 2 test asserting gate rejections are logged exists for this reason.
- Flipping the fallback default changes behavior for any non-agent MCP client (Studio, ad-hoc scripts): announce via commit message + SECURITY.md; keep the env override documented in `.env.example`.
- Audit file growth: unbounded append is acceptable for v1 (dev/LAN deployment); size-based rotation is a named follow-up, not this phase.
- Do not add portal-table audit writes now — it couples MCP to portal schema migrations; revisit after one week of local-file review.
