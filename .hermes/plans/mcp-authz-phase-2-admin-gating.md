# Phase 2 — Admin Gating & Role-Filtered Tool Surfaces (MCP authz)

> Companion to `2026-11-23_234507-mcp-per-user-authz.md`. Phase 1 made calls run as the user; this phase makes admin-scoped endpoints **unreachable** for non-admins, enforced server-side (model-independent), and hides admin tools from non-admin LLMs.

**Goal:** A tenant user — even a malicious one, even via prompt injection — cannot execute `_admin`-scoped MCP tools: the MCP server returns 403 before any portal round-trip, and the model never sees those tools in `tools/list`.

**Exit criteria:**
- [x] Tenant token → `tools/call user_list_admin` → MCP 403 (no portal request — verified by audit/console).
- [x] Tenant token → `tools/list` → no `_admin`/`_dash` tools present.
- [x] Platform admin token → both work as before.
- [x] No-token (legacy) callers: behavior unchanged from Phase 1 (service account), until Phase 3.
- [x] Agent: non-admin chat sessions don't offer admin actions; admin sessions do.
- [x] All tests/typecheck/build green in both repos.

**Prereq:** Phase 1 fully merged and smoke-tested.

---

## Part A — MCP server

### Task 1: Scope classification helper ✅ (commit `443e2a1`)

**Objective:** One function maps a tool id / endpoint path to its scope class, used by the gate (A2) and the list filter (A3).

**Files:**
- Modify: `mastra-nipp-mcp/src/mastra/tools/generate.ts` — export `deriveScope` (already exists at line 156) plus a new `classifyTool(path)` 
- Test: `mastra-nipp-mcp/tests/unit/scope.test.ts`

**Step 1: Failing tests:**

```ts
import { describe, it, expect } from 'vitest';
import { classifyTool } from '../../src/mastra/tools/generate.js';

describe('classifyTool', () => {
  it('admin scope for /api/admin/*', () => expect(classifyTool('/api/admin/users')).toBe('admin'));
  it('dash scope for /api/dashboard/admin/*', () => expect(classifyTool('/api/dashboard/admin/stats/overview')).toBe('dash'));
  it('tenant scope for /api/organizations/{id}/*', () => expect(classifyTool('/api/organizations/org1/work-orders')).toBe('tenant'));
  it('single scope otherwise', () => expect(classifyTool('/api/roles')).toBe('single'));
});
```

**Step 2:** Run → FAIL. **Step 3: Implement** (thin wrapper over the existing `deriveScope`):

```ts
/** Scope class for gating: 'admin' | 'dash' | 'tenant' | 'single'. */
export function classifyTool(path: string): 'admin' | 'dash' | 'tenant' | 'single' {
  return deriveScope(path) as 'admin' | 'dash' | 'tenant' | 'single';
}
```

**Step 4:** PASS. Commit: `feat(mcp): classifyTool scope helper`.

---

### Task 2: Call-time scope gate (the security boundary) ✅ (commit `f1ff858`)

**Objective:** In every generated tool's execute, reject admin-scoped calls from non-admin callers with a 403-shaped result **before** touching the portal.

**Files:**
- Modify: `mastra-nipp-mcp/src/mastra/tools/generate.ts` — execute body (Phase 1 Task 4 already added caller resolution)
- Modify: `mastra-nipp-mcp/src/mastra/config.ts` — add `enforceScopeGate: boolean` (env `MCP_ENFORCE_SCOPE_GATE`, default `'1'`)
- Test: `mastra-nipp-mcp/tests/unit/gate.test.ts`

**Step 1: Failing tests:**

```ts
it('blocks _admin tool for non-admin caller with 403, no portal call', async () => {
  const request = vi.fn();
  const tools = buildToolsWithCaller(miniSpec, request);
  __setVerifyCallerForTests(async () => ({ userId: 'u_tenant', orgId: 'org_t1', isPlatformAdmin: false }));
  const out = await tools['user_list_admin'].execute({}, ctxWithToken('tok'));
  expect(out).toMatchObject({ success: false, status: 403 });
  expect(String(out.error)).toMatch(/platform admin/i);
  expect(request).not.toHaveBeenCalled(); // never reached the portal
});
it('allows _admin tool for platform admin', async () => {
  __setVerifyCallerForTests(async () => ({ userId: 'u_admin', orgId: 'org_p', isPlatformAdmin: true }));
  const out = await tools['user_list_admin'].execute({}, ctxWithToken('tok'));
  expect(out.success).toBe(true);
  expect(request).toHaveBeenCalled();
});
it('allows tenant tool for tenant caller (no gate impact)', async () => { /* calevent tool passes through */ });
it('gate disabled via config → falls back to Phase 1 behavior', async () => {
  process.env.MCP_ENFORCE_SCOPE_GATE = '0';
  /* non-admin _admin call reaches request() — portal RBAC decides */
});
```

**Step 2:** Run → FAIL. **Step 3: Implement.** In the generated execute, right after caller resolution (Phase 1 Task 4):

```ts
if (config.enforceScopeGate) {
  const scope = classifyTool(ep.path);
  if (scope === 'admin' && !caller?.isPlatformAdmin) {
    return { success: false, status: 403, error: `Tool '${id}' requires a Platform organization admin. Caller is not authorized.` };
  }
  // Phase 2 decision (design doc open question 1): _dash tools are NOT gated here —
  // the portal's requirePermission enforces org-admin rights per target org;
  // a non-authorized caller gets the portal's own 403 with its message.
}
```

Note: when the gate is on and there is **no verified caller** (legacy no-token path), behavior stays Phase 1 (service account) — the gate only applies to *verified* callers. Document this in the tool description change below.

**Step 4:** PASS. Commit: `feat(mcp): server-side admin scope gate (403)`.

---

### Task 3: Per-caller tools/list filtering ✅ (commit `e4a8c3d`)

**Objective:** Non-admin callers don't see `_admin` tools in `tools/list` (context savings + reduced injection surface). The call-time gate remains authoritative.

**Files:**
- Modify: `mastra-nipp-mcp/src/mastra/mcp/server.ts` — use the Mastra server's per-request tool-list hook (`getToolListInfo(requestContext)`, verified present in `@mastra/mcp/dist/server/server.d.ts:355`) to drop admin-scoped tools when the request context carries a non-admin caller.

**Step 1: Failing test** — unit-test the filter function in isolation (export it):

```ts
// src/mastra/tools/filter.ts (new)
export function filterToolsForCaller(all: Record<string, ToolDef>, caller: McpCaller | null | undefined): Record<string, ToolDef>;
```

```ts
it('hides admin tools from non-admins', () => {
  const out = filterToolsForCaller({ user_list_admin: t, calevent_list_tenant: t }, { userId: 'u', isPlatformAdmin: false });
  expect(Object.keys(out)).not.toContain('user_list_admin');
  expect(Object.keys(out)).toContain('calevent_list_tenant');
});
it('shows everything to admins and to legacy (no-caller) requests', () => { /* both keep full list */ });
```

**Step 2:** Run → FAIL. **Step 3: Implement** filter + wire into `getToolListInfo` (read caller from the same requestContext key Phase 1 Task 4/5 established; `null`/absent → unfiltered, preserving legacy clients). **Step 4:** PASS. Commit: `feat(mcp): per-caller tools/list filtering`.

---

### Task 4: Server instructions + tool description update ✅ (commit `b7d9291`)

**Objective:** The server's `instructions` (currently claims "acts as a Platform-organization admin session") and the admin tools' descriptions must reflect the new model so the LLM is told the truth.

**Files:**
- Modify: `mastra-nipp-mcp/src/mastra/mcp/server.ts:41-59` — rewrite instructions: per-user identity, admin tools require platform admin (server-enforced), 403 meaning.
- Modify: `mastra-nipp-mcp/src/mastra/tools/generate.ts:259-268` (`buildDescription`) — append "Requires Platform admin." for `classifyTool(path) === 'admin'`.

**Step:** Manual review diff (no unit test; covered by integration). Commit: `docs(mcp): instructions reflect per-user authz model`.

---

## Part B — Agent

### Task 5: Role-aware domain tool surface ✅ (verified 2026-11-25)

**Objective:** Non-admin chat sessions don't offer admin actions to the model; admin sessions do. This is UX/defense-in-depth — the MCP gate (A2) is authoritative.

**Files:**
- Modify: `mastra-nipp-agent/src/app/api/chat/route.ts` — resolve caller role once per request (extend `getPortalSessionUser` with `isPlatformAdmin`, same query as Phase 1 Task 2 on the agent side — the agent already has `agentPrisma`) and set `requestContext.set('mastra__callerIsAdmin', …)`
- Modify: `mastra-nipp-agent/src/mastra/tools/dispatch.ts` — when `mastra__callerIsAdmin === false`, block tool ids whose ACTION_MAP entry is admin-scoped (maintain a small `ADMIN_TOOL_IDS` set derived from the domain-mapping: every non-`t_` action in user/org/role/perm/security/system/job tools) and return `{ success: false, error: 'This action requires administrator access.' }`
- Modify: `mastra-nipp-agent/src/mastra/tools/index.ts` (or per-domain tools) — keep tool *descriptions* static; the dispatch block is sufficient for v1 (YAGNI: no dynamic description rewriting).
- Test: `tests/unit/dispatch-admin-gate.test.ts`

**Step 1: Failing tests:**

```ts
it('blocks admin MCP tool ids for non-admin callers', async () => {
  // requestContext: mastra__callerIsAdmin=false → callMcpTool('user_list_admin', …) → 403-shaped error, execute never called
});
it('allows tenant-scoped tools for non-admins', async () => { /* t_list passes */ });
it('allows admin tools for admins', async () => { /* mastra__callerIsAdmin=true passes through */ });
```

**Step 2:** Run `npm run test` → FAIL. **Step 3: Implement.** **Step 4:** PASS. Commit: `feat(agent): role-filtered action dispatch`.

---

## Part C — Phase 2 validation & commit

### Task 6: Full validation pass ✅ (2026-11-25)

**Run log:**
- `mastra-nipp-agent`: `npm run test` → 9 files / 60 tests PASS (incl. new `dispatch-admin-gate.test.ts`, `admin-tool-ids.test.ts`); `npm run typecheck` → clean; `npm run build` → green.
- `mastra-nipp-mcp`: `npm test` → 7 files / 37 tests PASS; `npm run type-check` → clean; `npm run build` → "Build successful".
- MCP integration smoke (`scripts/smoke-phase2.ts`, live MCP dev server :4112 + portal :3000): **SMOKE PASS (6/6)**
  - tenant token → `tools/list` → total=106, `_admin`=**0** (hidden)
  - admin token → `tools/list` → total=177, `_admin`=**22** (full surface)
  - tenant token → `user_list_admin` → **403 from the MCP gate** (`Tool 'user_list_admin' requires a platform admin. Caller is not authorized.` — returned before any portal round-trip)
  - tenant token → `wo_organizations_work_orders_list` (own org) → **200** scoped data (gate doesn't affect tenant tools)
  - admin token → `user_list_admin` → **200**
  - no token → `user_list_admin` → **200** via legacy service fallback (unchanged; Phase 3 removes it)
- Agent integration smoke (`scripts/smoke-phase2.mts`, live portal :3000 + MCP :4112): **AGENT SMOKE PASS (5/5)**
  - `getPortalSessionUser(tenant bearer)` → `isPlatformAdmin=false`
  - `getPortalSessionUser(admin bearer)` → `isPlatformAdmin=true`
  - dispatch `user_list_admin` with `mastra__callerIsAdmin=false` → refusal (`This action requires administrator access.`), never reached the MCP transport
  - dispatch `user_list_admin` with `mastra__callerIsAdmin=true` → live MCP → **200**
  - dispatch tenant tool with `mastra__callerIsAdmin=false` → live MCP → **200** (no false-positive block)
- Note: the agent-side chat-level "model gets refusal" behavior is covered by the dispatch-level checks above (the domain tools funnel through `callMcpTool`; no separate LLM round-trip needed to prove the boundary).

---

## Phase 2 risks / watch-outs

- **The gate must fail closed on verification errors:** if `verifyCaller` throws/returns null for a *token-bearing* request while the gate is on, treat as non-admin (403), not as legacy. Legacy (service account) applies only to genuinely token-less requests.
- `_dash` scope: per design doc open question 1, we do **not** gate it in MCP — portal `requirePermission` is the authority. If the product answer changes, add one line to Task 2's gate (`scope === 'dash' && !caller.orgIsAdmin`).
- Keep the legacy no-token path fully functional through this phase — Phase 3 removes it.
- Agent-side block list must stay in sync with MCP tool ids; a new admin endpoint added to the portal spec should be caught by a test asserting every `classifyTool(...) === 'admin'` id from the live spec is in `ADMIN_TOOL_IDS` (add as Task 5 Step 3b, run against the generated spec).
