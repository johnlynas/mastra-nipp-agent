# Phase 1 — Per-Request Token Propagation (MCP authz)

> Companion to `2026-11-23_234507-mcp-per-user-authz.md` (main design). This phase makes every agent-initiated MCP tool call execute under the **calling user's** portal session token instead of the shared super-admin session. The legacy service-account fallback stays enabled (`MCP_ALLOW_SERVICE_FALLBACK=1`) so nothing breaks during rollout.

**Goal:** A tenant user's tool calls reach the portal with their own bearer token; admin-scoped calls by non-admins now fail at portal RBAC (403) instead of silently succeeding as super-admin.

**Exit criteria:**
- [x] Integration smoke: tenant token → `wo_list` returns their org's data; tenant token → `user_list_admin` returns 403 from the portal.
- [x] Platform admin token → `user_list_admin` returns 200.
- [x] No-token calls still work via service fallback (legacy).
- [x] Agent repo: `npm run test`, `npm run typecheck`, `npm run build` green. MCP repo: new `npm test` + `npm run type-check` green.

---

## Part A — MCP server (mastra-nipp-mcp)

### Task 1: Test infra for the MCP repo ✅ DONE (commit `328e5c3`)

**Objective:** The MCP repo has no test runner; add vitest so Tasks 2–5 are TDD-able.

**Files:**
- Modify: `mastra-nipp-mcp/package.json` (scripts + devDependencies)
- Create: `mastra-nipp-mcp/vitest.config.ts`
- Create: `mastra-nipp-mcp/tests/unit/config.test.ts`

**Step 1: Add vitest config and script.** In `package.json`:

```json
"scripts": { "dev": "mastra dev", "build": "mastra build", "start": "mastra start",
  "stdio": "tsx src/mastra/mcp/stdio.ts", "type-check": "tsc --noEmit",
  "test": "vitest run" },
"devDependencies": { /* existing + */ "vitest": "^3.2.0" }
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node' } });
```

**Step 2: Write a failing smoke test** in `tests/unit/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/mastra/config.js';

describe('loadConfig', () => {
  it('reads PORTAL_BASE_URL and strips trailing slash', () => {
    process.env.PORTAL_BASE_URL = 'http://localhost:3000/';
    expect(loadConfig().baseUrl).toBe('http://localhost:3000');
  });
});
```

**Step 3:** Run `npm test` → PASS (config already exists; this validates the harness). Commit: `test(mcp): add vitest harness`.

---

### Task 2: `verifyCaller()` — token verification + cache (MCP side) ✅ DONE (commit `ddf65ac`)

Live gate (Step 5) verified against the docker test stack via `scripts/probe-verify-caller.ts`:
admin → `{isPlatformAdmin:true}`, tenant → `{isPlatformAdmin:false, orgId set}`, bogus token → `null` — GATE PASS.

**Objective:** Verify a portal session token and resolve caller identity (`userId`, `activeOrganizationId`, `isPlatformAdmin`), with a short-TTL cache.

**Files:**
- Modify: `mastra-nipp-mcp/package.json` — add deps: `better-auth`, `@prisma/adapter-pg`, `@prisma/client` (match versions in `mastra-nipp-agent/package.json`; the agent's `src/mastra/auth.ts` is the reference implementation)
- Create: `mastra-nipp-mcp/prisma/schema.prisma` — copy **verbatim** from `nipp-0111/prisma/schema.prisma` (same approach as the agent repo; generator output dir `prisma/generated/prisma`, import via `@prisma-gen/client`)
- Create: `mastra-nipp-mcp/src/mastra/auth.ts`
- Test: `mastra-nipp-mcp/tests/unit/auth.test.ts`

**Step 1: Write failing tests** (`tests/unit/auth.test.ts`). Mock the BetterAuth instance and Prisma client (inject via module-level setters or `vi.mock`):

```ts
import { describe, it, expect, vi } from 'vitest';
import { verifyCaller, __setDepsForTests, clearCallerCache } from '../../src/mastra/auth.js';

const fakeSession = { user: { id: 'u_tenant', name: 'T', email: 't@x.io' } };
function deps(getSession: unknown, prisma: unknown) { __setDepsForTests({ getSession, prisma }); }

describe('verifyCaller', () => {
  it('rejects empty token', async () => {
    deps(vi.fn(), {});
    await expect(verifyCaller('')).resolves.toBeNull();
  });
  it('rejects invalid session', async () => {
    deps(async () => null, {});
    await expect(verifyCaller('tok-bad')).resolves.toBeNull();
  });
  it('resolves tenant caller with org + non-admin flag', async () => {
    deps(async () => fakeSession, { user: { findUnique: async () => ({ banned: false, banExpires: null, activeOrganizationId: 'org_t1' }) }, member: { findFirst: async () => null } });
    const c = await verifyCaller('tok-tenant');
    expect(c).toMatchObject({ userId: 'u_tenant', orgId: 'org_t1', isPlatformAdmin: false });
  });
  it('flags platform admin via Member row for PLATFORM_ORG_ID', async () => {
    process.env.PLATFORM_ORG_ID = 'org_platform';
    deps(async () => fakeSession, { user: { findUnique: async () => ({ banned: false, banExpires: null, activeOrganizationId: 'org_platform' }) }, member: { findFirst: async () => ({ id: 'm1' }) } });
    expect((await verifyCaller('tok-admin'))?.isPlatformAdmin).toBe(true);
  });
  it('rejects banned user (active ban)', async () => {
    deps(async () => fakeSession, { user: { findUnique: async () => ({ banned: true, banExpires: new Date(Date.now() + 864e5), activeOrganizationId: 'org_t1' }) } });
    await expect(verifyCaller('tok-banned')).resolves.toBeNull();
  });
  it('caches by token (second call hits no DB)', async () => {
    const findUnique = vi.fn(async () => ({ banned: false, banExpires: null, activeOrganizationId: 'org_t1' }));
    deps(async () => fakeSession, { user: { findUnique: findUnique }, member: { findFirst: async () => null } });
    clearCallerCache();
    await verifyCaller('tok-cache'); await verifyCaller('tok-cache');
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2:** Run `npm test` → FAIL (module missing).

**Step 3: Implement `src/mastra/auth.ts`.** Mirror `mastra-nipp-agent/src/mastra/auth.ts` (thin BetterAuth, shared `BETTER_AUTH_SECRET`, Prisma via `PrismaPg` adapter, globalThis singleton), plus:

```ts
export interface McpCaller { userId: string; orgId?: string; isPlatformAdmin: boolean; }

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: McpCaller | null }>();
export function clearCallerCache() { cache.clear(); }

/** Verify a portal session token → caller identity. null = reject (fail-closed on any error). */
export async function verifyCaller(token: string): Promise<McpCaller | null> {
  if (!token) return null;
  const key = sha256hex(token);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: McpCaller | null = null;
  try {
    const session = await mcpAuth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) });
    const user = session?.user;
    if (!user?.id) return null;
    const row = await mcpPrisma.user.findUnique({ where: { id: user.id }, select: { banned: true, banExpires: true, activeOrganizationId: true } });
    if (!row) return null;
    if (row.banned && !(row.banExpires && new Date(row.banExpires) < new Date())) return null;
    const platformOrgId = process.env.PLATFORM_ORG_ID ?? '';
    const member = platformOrgId
      ? await mcpPrisma.member.findFirst({ where: { userId: user.id, organizationId: platformOrgId }, select: { id: true } })
      : null;
    value = { userId: user.id, orgId: row.activeOrganizationId ?? undefined, isPlatformAdmin: !!member };
  } catch { value = null; } // fail closed — DB/auth unavailable ⇒ reject
  cache.set(key, { at: Date.now(), value });
  return value;
}
```

Notes: `mcpAuth` uses the `bearer()` plugin (same as agent) so `getSession({ headers })` resolves from the Authorization header. `sha256hex` = node:crypto. The `Member` table is RLS-scoped on `organizationId`, so the explicit filter is what makes the platform row visible under the non-owner role (design doc R6).

**Step 4:** Run `npm test` → PASS. Commit: `feat(mcp): verifyCaller token verification with TTL cache`.

**Step 5 (integration check, manual):** With the docker test stack up (`nipp-0111/docker-compose.test.yml`, source `.env.test`), sign in as a known tenant user and a known platform admin via the portal API, then run a tiny `tsx` script calling `verifyCaller()` with both tokens. Expected: tenant → `{ isPlatformAdmin: false }`, admin → `{ isPlatformAdmin: true }`. If the admin check fails, stop and debug RLS visibility before proceeding (R6).

---

### Task 3: `PortalClient` per-request token ✅ DONE (commit `86ecc09`)

**Objective:** `client.request()` forwards a caller-supplied bearer token when provided; falls back to service sign-in only when none is given.

**Files:**
- Modify: `mastra-nipp-mcp/src/mastra/client.ts:117-153`
- Test: `mastra-nipp-mcp/tests/unit/client.test.ts`

**Step 1: Failing test** (`tests/unit/client.test.ts`) — mock global `fetch`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { PortalClient } from '../../src/mastra/client.js';

const cfg = { baseUrl: 'http://portal.test', email: '', password: '', defaultOrgId: 'org_p', excludePathPrefixes: [] };

describe('PortalClient per-request token', () => {
  it('forwards the caller token as Authorization and never signs in', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const c = new PortalClient(cfg as any);
    await c.request('GET', '/api/organizations/org_t1/work-orders', { bearerToken: 'tok-user-123', orgId: 'org_t1' });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as any).Authorization).toBe('Bearer tok-user-123');
    expect((init.headers as any)['x-org-id']).toBe('org_t1');
    expect(fetchMock).toHaveBeenCalledTimes(1); // no sign-in call
  });

  it('falls back to service sign-in when no token and fallback allowed', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      n++;
      if (String(url).includes('/api/auth/sign-in/email')) return new Response(JSON.stringify({ token: 'svc-tok' }), { status: 200, headers: { 'set-auth-token': 'svc-tok', 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    process.env.MCP_ALLOW_SERVICE_FALLBACK = '1';
    const c = new PortalClient({ ...cfg, email: 'a@x.io', password: 'p' } as any);
    await c.request('GET', '/api/admin/users');
    expect(n).toBe(2); // sign-in + request
  });

  it('rejects when no token and fallback disabled', async () => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.MCP_ALLOW_SERVICE_FALLBACK = '0';
    const c = new PortalClient(cfg as any);
    await expect(c.request('GET', '/api/admin/users')).rejects.toThrow(/no caller token/);
  });
});
```

**Step 2:** Run → FAIL.

**Step 3: Implement.** In `PortalRequestOptions` add `bearerToken?: string`. In `request()`:

```ts
async request(method, path, opts = {}) {
  if (opts.bearerToken) return this.doRequest(method, path, { ...opts }); // no ensureSession, no re-auth retry
  if (!process.env.MCP_ALLOW_SERVICE_FALLBACK || process.env.MCP_ALLOW_SERVICE_FALLBACK === '0') {
    throw new Error('No caller token provided and service-account fallback is disabled (MCP_ALLOW_SERVICE_FALLBACK=0).');
  }
  await this.ensureSession();
  const result = await this.doRequest(method, path, opts);
  if (result.status === 401 && this.token) { /* existing re-auth retry */ }
  return result;
}
```

In `doRequest`, build the header from `opts.bearerToken ?? this.token` (a caller-token request with an empty service token must not sign in — the throw above guarantees a token exists on each path). Keep the 30s sign-in cooldown for the service path only.

**Step 4:** Run → PASS. Commit: `feat(mcp): per-request bearer token in PortalClient`.

---

### Task 4: Generated tools read the caller from requestContext ✅ DONE (commit `0b35af3`)

**Objective:** Every generated tool's `execute` resolves the verified caller and passes its token to `client.request`; missing caller → legacy fallback (Phase 1) with a warning.

**Files:**
- Modify: `mastra-nipp-mcp/src/mastra/tools/generate.ts:285-308` (execute body)
- Modify: `mastra-nipp-mcp/src/mastra/mcp/server.ts` — build tools with access to `verifyCaller`; store the verified caller in requestContext per request
- Test: `mastra-nipp-mcp/tests/unit/generate-caller.test.ts`

**How the token reaches `execute`:** The MCP server receives `Authorization: Bearer <tok>` on each Streamable HTTP POST. In `server.ts`, add a small helper that the tool factory consults — Mastra's `@mastra/mcp` passes a per-request `RequestContext` into `tool.execute(input, context)` (`runTool`, dist index.js:24772-24780), and `toRequestContext` populates it from transport auth. **Implementation:** in `generateTools`, change the execute signature to `(input, context)`:

```ts
execute: async (input: any, context?: any) => {
  const caller = await resolveCallerFromContext(context); // new helper below
  const res = await client.request(ep.method, ep.path, {
    pathParams, query, body, orgId: input.orgId,
    bearerToken: caller?.token,   // undefined → legacy fallback (Phase 1)
  });
  /* existing result shaping */
}
```

`resolveCallerFromContext(context)` (new module `src/mastra/tools/caller.ts`):
1. Read the raw token from `context?.requestContext?.get('mastra__mcpToken')` **or** fall back to parsing it from the MCP transport auth (`context?.mcp?.extra?.authInfo?.token`) — implement whichever is populated in practice (verify with a one-off dev probe: log both keys during a live `tools/call`; keep the working path, drop the other).
2. If a token exists: `const caller = await verifyCaller(token)`; return `{ token }` on success, `null` + warning log on failure (Phase 1 degrades to legacy; Phase 2 turns this into a 401).

**Step 1: Failing test** (`tests/unit/generate-caller.test.ts`) — build one tool from a minimal spec fixture and assert its execute passes the token through:

```ts
it('passes the verified caller token to client.request', async () => {
  const request = vi.fn(async () => ({ status: 200, ok: true, data: {} }));
  const tools = generateTools(miniSpec, { request } as any, ['/api/auth']);
  const tool = tools['user_list_admin'];
  // stub verifyCaller via the caller module's test seam
  __setVerifyCallerForTests(async (t) => t === 'tok-ok' ? { userId: 'u1', orgId: 'o1', isPlatformAdmin: true } : null);
  await tool.execute({ page: 1 }, { requestContext: new RequestContext().set('mastra__mcpToken', 'tok-ok') } as any);
  expect(request).toHaveBeenCalledWith(expect.any(String), '/api/admin/users', expect.objectContaining({ bearerToken: 'tok-ok' }));
});
it('falls back (no token) when context has no caller', async () => {
  /* same, execute with empty context → request called with bearerToken: undefined */
});
```

**Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. Commit: `feat(mcp): tools forward verified caller token`.

**Step 5 (integration probe):** Start MCP dev server + agent; make one chat tool call; confirm the portal access log shows the tenant user's session (not the service account) — e.g., audit-log `userId` in the portal response or a temporary console log in `doRequest`. Remove the temporary log.

---

### Task 5: Server-side token capture + config flags ✅ DONE (commit `0b35af3`)

**Objective:** Ensure the incoming `Authorization` header is available to tools per request; add env flags to `config.ts`.

**Files:**
- Modify: `mastra-nipp-mcp/src/mastra/config.ts` — add `allowServiceFallback: boolean` (env `MCP_ALLOW_SERVICE_FALLBACK`, default `'1'`) and `platformOrgId: string` (env `PLATFORM_ORG_ID`)
- Modify: `mastra-nipp-mcp/src/mastra/mcp/server.ts` — if the Task 4 probe shows `authInfo.token` is populated by the transport, no extra work; otherwise register a thin HTTP middleware on the Mastra server (`apiRoutes` pre-handler) that copies `req.headers.get('authorization')` into a per-request store consumed by `resolveCallerFromContext`. (Decide from the Task 4 probe; document which path shipped.)
- Test: extend `tests/unit/config.test.ts` for the new flags.

**Steps:** failing config test → implement → pass → commit: `feat(mcp): auth env flags + per-request token capture`.

---

## Part B — Agent (mastra-nipp-agent)

### Task 6: Chat route sets the session token in requestContext ✅ DONE (agent commit `69e00b5`)

**Objective:** `/api/chat` puts the caller's portal session token into `requestContext` under `mastra__portalSessionToken`.

**Files:**
- Modify: `mastra-nipp-agent/src/lib/auth-client.ts:63-101` — extend `PortalSessionUser` with `sessionToken?: string` and return it (read from the same headers used for `getSession`: bearer header value, or the session cookie value after normalization)
- Modify: `mastra-nipp-agent/src/app/api/chat/route.ts:48-49` — `requestContext.set('mastra__portalSessionToken', user.sessionToken ?? '')`

**Step 1: Failing test** in `tests/unit/` (new file `session-token.test.ts`) — mock `agentAuth.api.getSession` to return a session, assert `getPortalSessionUser` returns the token for both doors (bearer header; secure cookie):

```ts
it('returns the bearer token when the bearer door is used', async () => {
  // headers: Authorization: Bearer tok-abc → expect user.sessionToken === 'tok-abc'
});
it('returns the session cookie value for the cookie door', async () => {
  // Cookie: __Secure-better-auth.session_token=tok-cookie → expect 'tok-cookie'
});
```

**Step 2:** Run `npm run test` → FAIL. **Step 3:** Implement (in `getPortalSessionUser`, capture the token value before/while building `headers`: bearer door → strip `Bearer ` prefix; cookie door → the normalized cookie value). **Step 4:** PASS. Commit: `feat(agent): expose session token in PortalSessionUser`.

---

### Task 7: Dispatch carries the token to the MCP client ✅ DONE (agent commit `69e00b5`)

Shipped path: dispatch passes the tool call's `requestContext` into the MCP client tool's `execute` (was `undefined`), so `@mastra/mcp` runs the call in an operation scope and the transport fetch hook receives it — no AsyncLocalStorage needed.

**Objective:** `callMcpTool` reads `mastra__portalSessionToken` from requestContext and makes it available to the MCP transport fetch hook (Task 8) — via an AsyncLocalStorage or a per-call option threaded through `execute`.

**Files:**
- Modify: `mastra-nipp-agent/src/mastra/tools/dispatch.ts`
- Test: extend existing dispatch tests pattern (`tests/unit/org-tool.test.ts` shows the mock style).

**Mechanism (keep it simple, YAGNI):** The MCPClient's custom `fetch` receives a `requestContext` as its 3rd argument (`MastraFetchLike`, verified in `@mastra/mcp/dist/client/types.d.ts:480-512`) — the same context the tool runs under. So dispatch needs **no changes to pass the token**: Task 8's fetch hook reads `requestContext?.get('mastra__portalSessionToken')` directly. Verify with a test that a tool executed with a populated requestContext results in the fetch hook seeing it:

```ts
it('fetch hook receives mastra__portalSessionToken from the tool call context', async () => {
  // mock portalMcp.listToolsWithErrors → one fake tool whose execute captures nothing;
  // assert the fetch spy was called with a requestContext containing the token
});
```

If (and only if) the probe shows the fetch hook's requestContext is `null` for tool calls, thread the token explicitly: add `opts.portalToken` to `callMcpTool`, store it in an AsyncLocalStorage set around `entry.handle.execute(...)`, read it in the fetch hook. Decide from the test; document which shipped.

**Steps:** failing test → implement → pass → commit: `feat(agent): expose caller token to MCP transport`.

---

### Task 8: MCPClient custom fetch injects Authorization ✅ DONE (agent commit `69e00b5`)

**Objective:** Every outbound MCP request carries the caller's token.

**Files:**
- Modify: `mastra-nipp-agent/src/mastra/mcp/client.ts`

**Step 1: Failing test** — extract the fetch factory into an exported pure function `portalMcpFetch()` and unit-test it:

```ts
it('adds Authorization when the requestContext has a token', async () => {
  const inner = vi.fn(async () => new Response('{}'));
  const f = portalMcpFetch(inner);
  await f(new URL('http://mcp.test/mcp'), { method: 'POST' }, new RequestContext().set('mastra__portalSessionToken', 'tok-x'));
  expect(inner).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer tok-x' }) }));
});
it('sends no Authorization when there is no token (legacy server fallback)', async () => { /* headers lack authorization */ });
```

**Step 2:** Run → FAIL. **Step 3: Implement:**

```ts
export function portalMcpFetch(inner: typeof fetch) {
  return async (url: URL | string, init?: RequestInit, requestContext?: RequestContext | null): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const token = requestContext?.get('mastra__portalSessionToken');
    if (typeof token === 'string' && token) headers.set('authorization', `Bearer ${token}`);
    return inner(url as URL, { ...init, headers });
  };
}

export const portalMcp = new MCPClient({
  id: 'portal-client',
  servers: { nippPortal: { url: new URL(loadConfig().portalMcpUrl), fetch: portalMcpFetch(fetch) } },
});
```

**Step 4:** PASS. Commit: `feat(agent): per-request Authorization on MCP transport`.

---

## Part C — Phase 1 validation & commit

### Task 9: Full validation pass ✅ DONE (2026-11-24)

**Run log:**
- `mastra-nipp-agent`: `npm run test` → 7 files / 54 tests PASS; `npm run typecheck` → clean; `npm run build` → green.
- `mastra-nipp-mcp`: `npm test` → 4 files / 20 tests PASS; `npm run type-check` → clean; `npm run build` → "Build successful".
- Integration smoke (`scripts/smoke-phase1.ts`, live MCP dev server :4112 + portal :3000, commit `05a16c2`): **SMOKE PASS (4/4)**
  - tenant token → `wo_organizations_work_orders_list` (own org) → **200**, scoped data
  - tenant token → `user_list_admin` → **403** from portal RBAC
  - admin token → `user_list_admin` → **200**
  - no token → `user_list_admin` → **200** via legacy service fallback
- Fixture fix found during smoke: the probe tenant had no `Member` row in its active org, so the portal correctly 403'd the tenant-scoped work-order route; smoke script now upserts the membership idempotently.

---

## Phase 1 risks / watch-outs

- **R3/R6 first:** the Task 2 Step 5 live check is a gate — do not build Tasks 3–8 on an unverified `verifyCaller`.
- The MCP repo will now need `DATABASE_URL`, `BETTER_AUTH_SECRET`, `PLATFORM_ORG_ID` in its `.env` (copy values from the agent's `.env`; add to `.env.example`).
- Do **not** remove the 30s sign-in cooldown — it protects the service-fallback path.
- Token must never be logged: audit/logging code (Phase 3) stores `userId` only.
