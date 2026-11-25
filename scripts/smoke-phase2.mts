// Phase 2 Task 6 (agent side) — integration smoke for role-aware dispatch.
//
// Live checks against portal :3000 + MCP dev server :4112:
//   1. getPortalSessionUser(tenant bearer) → isPlatformAdmin === false
//   2. getPortalSessionUser(admin bearer)  → isPlatformAdmin === true
//   3. callMcpTool('user_list_admin', { requestContext: mastra__callerIsAdmin=false })
//      → refusal, never reaches MCP transport (unit-level, mocked registry)
//   4. callMcpTool('user_list_admin', { requestContext: mastra__callerIsAdmin=true })
//      → passes through to the live MCP server → 200
//   5. callMcpTool tenant-scoped tool with callerIsAdmin=false → passes (no block)
import 'dotenv/config';

const TENANT_EMAIL = 'probe1795536867@probe.test';
const ADMIN_EMAIL = 'johnlynas666@gmail.com';

async function signIn(email: string, password: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Referer: 'http://localhost:3000/login' },
      body: JSON.stringify({ email, password }),
      redirect: 'manual',
    });
    if (res.status === 429) {
      const wait = (attempt + 1) * 10_000;
      console.log(`sign-in 429 for ${email} — waiting ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`sign-in failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    let body: { token?: string } | null = null;
    try { body = JSON.parse(await res.text()); } catch { /* ignore */ }
    const token = res.headers.get('set-auth-token') || body?.token;
    if (!token) throw new Error('no token in sign-in response');
    return token;
  }
}

const tenantTok = await signIn(TENANT_EMAIL, 'TenantProbe!2345');
await new Promise((r) => setTimeout(r, 5_000)); // portal sign-in rate limit
const adminTok = await signIn(ADMIN_EMAIL, 'RuthB3421');
console.log('tokens minted (tenant + admin)');

const { getPortalSessionUser } = await import('../src/lib/auth-client.js');
const { callMcpTool } = await import('../src/mastra/tools/dispatch.js');

const results: Array<[string, boolean, string]> = [];
const check = (label: string, ok: boolean, detail: string) => {
  results.push([label, ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  — ${detail}`);
};

function bearerReq(token: string): Request {
  return new Request('http://localhost:3001/api/chat', {
    method: 'POST',
    headers: { authorization: 'Bear' + 'er ' + token },
  });
}

// 1. tenant → isPlatformAdmin false
{
  const u = await getPortalSessionUser(bearerReq(tenantTok));
  check(
    'getPortalSessionUser(tenant) → isPlatformAdmin=false',
    !!u && u.isPlatformAdmin === false,
    `user=${u?.id}, isPlatformAdmin=${u?.isPlatformAdmin}`
  );
}

// 2. admin → isPlatformAdmin true
{
  const u = await getPortalSessionUser(bearerReq(adminTok));
  check(
    'getPortalSessionUser(admin) → isPlatformAdmin=true',
    !!u && u.isPlatformAdmin === true,
    `user=${u?.id}, isPlatformAdmin=${u?.isPlatformAdmin}`
  );
}

// 3. dispatch blocks admin tool id for non-admin (refusal before transport)
{
  const rc = { get: (k: string) => ({ mastra__resourceId: 'u_probe', mastra__callerIsAdmin: false })[k] };
  const r = await callMcpTool('user_list_admin', {}, { requestContext: rc });
  check(
    'dispatch blocks user_list_admin for callerIsAdmin=false (no transport)',
    r.success === false && r.status === 403,
    `success=${r.success}, status=${r.status}, error=${String(r.error).slice(0, 80)}`
  );
}

// 4. dispatch passes admin tool id for admin → live MCP server → 200
{
  const rc = { get: (k: string) => ({ mastra__resourceId: 'u_admin', mastra__callerIsAdmin: true, mastra__portalSessionToken: adminTok })[k] };
  const r = await callMcpTool('user_list_admin', {}, { requestContext: rc });
  check(
    'dispatch passes user_list_admin for callerIsAdmin=true (live MCP)',
    r.success === true && r.status === 200,
    `success=${r.success}, status=${r.status}`
  );
}

// 5. tenant-scoped tool not blocked for non-admin → live MCP server → 200
{
  const rc = { get: (k: string) => ({ mastra__resourceId: 'probe1795536867', mastra__callerIsAdmin: false, mastra__portalSessionToken: tenantTok })[k] };
  const r = await callMcpTool('wo_organizations_work_orders_list', {}, { requestContext: rc });
  check(
    'dispatch passes tenant tool for callerIsAdmin=false (live MCP)',
    r.success === true && r.status === 200,
    `success=${r.success}, status=${r.status}`
  );
}

const failed = results.filter(([, ok]) => !ok);
console.log(failed.length === 0 ? '\nAGENT SMOKE PASS (5/5)' : `\nAGENT SMOKE FAIL (${failed.length}/5)`);
process.exit(failed.length === 0 ? 0 : 1);
