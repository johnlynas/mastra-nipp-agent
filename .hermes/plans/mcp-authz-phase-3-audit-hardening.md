# Phase 3 — Audit Logging, Hardening & Docs (MCP authz)

> Companion to `2026-11-23_234507-mcp-per-user-authz.md`. Phases 1–2 fixed identity and privilege; this phase makes the change **observable** (audit), removes the last admin-session escape hatch (service fallback off by default), and documents the new security model.

**Goal:** Every MCP tool call produces a durable audit record of who/what/where/outcome; unauthenticated MCP calls are rejected (401) so the super-admin session is no longer reachable from MCP by default; both repos' `SECURITY.md` describe the enforced model.

**Exit criteria:**
- [ ] Audit log line emitted for every tool call: `{ ts, userId|'legacy-service', toolId, scope, orgId, status, latencyMs }`.
- [ ] No-token call → 401 (with `MCP_ALLOW_SERVICE_FALLBACK` at its new default `0`); setting the flag to `1` restores legacy behavior.
- [ ] Portal negative test: tenant session directly against `/api/admin/users` → 403 (proves portal layer holds independently of MCP).
- [ ] `SECURITY.md` updated in both repos; threat-model table from design doc reflected.
- [ ] All tests/typecheck/build green in both repos.

**Prereq:** Phase 2 merged, running in dev for at least one full day (audit log reviewed for shape before we make it the record of truth).

---

## Part A — MCP server

### Task 1: Audit logger module

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

### Task 2: Wire audit into generated tools + utility tools

**Objective:** Every execute path records a call, including gate rejections and legacy calls.

**Files:**
- Modify: `mastra-nipp-mcp/src/mastra/tools/generate.ts` — wrap the existing execute body: measure `latencyMs`, resolve final `status` (portal status, 403 from gate, 401 from missing caller), call `logToolCall`. Caller id = verified `userId`, or `'legacy-service'` when the service fallback ran.
- Modify: `mastra-nipp-mcp/src/mastra/tools/utility.ts` — same for `portal_health` / `portal_session_verify` (these are diagnostics; log with scope `'system'`).
- Test: extend `tests/unit/gate.test.ts` — assert a 403 gate rejection produces an audit line with `userId` of the tenant and `status: 403`.

**Steps:** failing assertion → implement → pass → commit: `feat(mcp): audit every tool call incl. rejections`.

---

### Task 3: Remove service fallback by default

**Objective:** The super-admin session stops being reachable from MCP unless explicitly opted in.

**Files:**
- Modify: `mastra-nipp-mcp/src/mastra/config.ts` — flip default of `MCP_ALLOW_SERVICE_FALLBACK` to `'0'`.
- Modify: `mastra-nipp-mcp/src/mastra/client.ts` — the Phase 1 throw path already exists; extend the message to name the flag.
- Modify: `mastra-nipp-mcp/.env.example` (create if absent) — document `MCP_ALLOW_SERVICE_FALLBACK=0` default, `PLATFORM_ORG_ID`, `DATABASE_URL`, `BETTER_AUTH_SECRET`.
- Test: update Phase 1 client tests' expectations for the new default (no-token → reject by default; flag `1` → legacy).

**Steps:** failing test (new default) → implement → pass → commit: `feat(mcp): service-account fallback off by default`.

**Rollback note:** `MCP_ALLOW_SERVICE_FALLBACK=1` in the environment restores pre-Phase-3 behavior immediately — no redeploy needed beyond env reload.

---

### Task 4: Version-pin regression guard

**Objective:** The whole design leans on `@mastra/mcp` passing per-request context into tool execute (design doc R5). Make breakage loud.

**Files:**
- Create: `mastra-nipp-mcp/tests/integration/context-propagation.test.ts` — spins the real `MCPServer` in-process (or via `mastra dev` on a test port), issues one `tools/call` with an `Authorization` header, asserts the tool's execute observed the token. Mark `testTimeout(30_000)`.
- Modify: `mastra-nipp-mcp/SECURITY.md` — add "Framework upgrade checklist": run this test before bumping `@mastra/mcp`; it is the canary for requestContext/authInfo plumbing.

**Steps:** implement (no RED needed — green-by-construction regression) → run once to prove it passes today → commit: `test(mcp): context propagation canary`.

---

## Part B — Portal (nipp-0111) — verification only, no code changes

### Task 5: Portal negative tests (defense-in-depth proof)

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

### Task 6: SECURITY.md updates (both repos)

**Files:**
- Modify: `mastra-nipp-mcp/SECURITY.md` — new section "Per-request user authorization": architecture flow table (login → agent init → tool call), token propagation path, gate semantics, legacy-fallback flag, audit log location/format, framework upgrade checklist.
- Modify: `mastra-nipp-agent/SECURITY.md` — mirror: what the agent guarantees (session verified per request, token never from client body, role-filtered dispatch) and what it delegates to MCP/portal.
- Modify: `mastra-nipp-mcp/src/mastra/mcp/server.ts` instructions if Phase 2 wording needs a "no legacy by default" sentence.

**Steps:** draft → review against design doc threat-model table (every row has a named enforcement layer) → commit: `docs: per-request authz security model`.

### Task 7: Full validation pass + close-out

1. Both repos: tests + typecheck + build green; portal repo: new negative tests green.
2. End-to-end run log (append to each phase doc): tenant/admin/no-token/banned scenarios with actual status codes and one sample audit line (token redacted).
3. Confirm design-doc open questions are resolved in writing (answers recorded in the main design doc §4): `_dash` gating decision; audit destination (local file — portal-table write logged as follow-up).
4. Final commit: `feat(authz): audit, hardening, docs (phase 3)`.

**Run log:** _(fill during execution)_

---

## Phase 3 risks / watch-outs

- **Audit completeness > audit beauty:** a call that executes without an audit line is a silent gap — the Task 2 test asserting gate rejections are logged exists for this reason.
- Flipping the fallback default changes behavior for any non-agent MCP client (Studio, ad-hoc scripts): announce via commit message + SECURITY.md; keep the env override documented in `.env.example`.
- Audit file growth: unbounded append is acceptable for v1 (dev/LAN deployment); size-based rotation is a named follow-up, not this phase.
- Do not add portal-table audit writes now — it couples MCP to portal schema migrations; revisit after one week of local-file review.
