import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_TOOL_IDS } from '@/mastra/tools/admin-tools';

/**
 * Phase 2 task 5 (step 3b): keep ADMIN_TOOL_IDS in sync with the live portal
 * spec. Re-derives every generated tool id whose endpoint is admin-scoped
 * (/api/admin/*) from mastra-nipp-mcp/openapi/openapi.json using the same
 * derivation as the MCP server's generate.ts, and asserts each one is in
 * ADMIN_TOOL_IDS. When a new admin endpoint lands in the spec this test fails
 * — add the id to admin-tools.ts.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const specPath = path.join(repoRoot, '..', 'mastra-nipp-mcp', 'openapi', 'openapi.json');

// --- id derivation (mirror of mastra-nipp-mcp/src/mastra/tools/generate.ts) ---
const DOMAIN_ROOTS: Record<string, string> = {
  org: 'organizations', user: 'users', role: 'roles', wo: 'work-orders', wonote: 'work-order-notes',
  contractor: 'contractors', invoice: 'invoices', quote: 'quotes', calevent: 'calendar-events',
  calnotif: 'calendar-notifications', calendar: 'calendar', perm: 'permissions', resource: 'resources',
  unit: 'units', job: 'jobs', script: 'scripts',
};

function deriveDomain(s: string): string {
  if (s.includes('work-order-notes')) return 'wonote';
  if (s.includes('work-orders') || s.includes('work-order')) return 'wo';
  if (s.includes('contractors')) return 'contractor';
  if (s.includes('invoices')) return 'invoice';
  if (s.includes('quotes')) return 'quote';
  if (s.includes('calendar-events')) return 'calevent';
  if (s.includes('calendar-notifications')) return 'calnotif';
  if (s.includes('/calendar')) return 'calendar';
  if (s.includes('teams')) return 'team';
  if (s.startsWith('admin/organizations') || s.startsWith('dashboard/admin/organizations')) return 'org';
  if (s.startsWith('admin/users') || s.startsWith('dashboard/admin/users')) return 'user';
  if (s.startsWith('admin/roles') || s.startsWith('dashboard/admin/roles') || s === 'roles' || s.startsWith('roles/')) return 'role';
  if (s.includes('permissions/resources')) return 'resource';
  if (s.includes('permissions')) return 'perm';
  if (s.includes('/resources')) return 'resource';
  if (s.includes('/units')) return 'unit';
  if (s.startsWith('admin/jobs')) return 'job';
  if (s.includes('/scripts')) return 'script';
  if (s.includes('audit-logs') || s.includes('system-logs') || s.includes('metrics') || s.startsWith('cache/')) return 'system';
  if (s.startsWith('security/')) return 'security';
  if (s.startsWith('admin/notifications') || s === 'notifications/stream') return 'notif';
  if (s.startsWith('dashboard/admin/stats') || s.startsWith('dashboard/admin/errors')) return 'system';
  if (s.startsWith('organizations/')) return 'tenant_org';
  return 'misc';
}

function deriveSubpath(p: string, domain: string): string[] {
  let t = p;
  for (const pref of ['admin/', 'dashboard/admin/']) if (t.startsWith(pref)) t = t.slice(pref.length);
  const root = DOMAIN_ROOTS[domain];
  if (root) {
    if (t === root) t = '';
    else if (t.startsWith(root + '/')) t = t.slice(root.length + 1);
  }
  return t.split('/').filter((x) => x && !x.startsWith('{')).map((x) => x.replace(/-/g, '_'));
}

function deriveAction(method: string, pathStr: string): string {
  const segs = pathStr.split('/').filter(Boolean);
  const last = segs[segs.length - 1] ?? '';
  const prev = segs[segs.length - 2] ?? '';
  const lastIsParam = last.startsWith('{');
  const prevIsParam = prev.startsWith('{');
  if (method === 'GET') return lastIsParam ? 'get' : 'list';
  if (method === 'DELETE') return 'delete';
  if (method === 'PATCH') return prevIsParam && !lastIsParam ? last.replace(/-/g, '_') : 'update';
  if (method === 'POST') return prevIsParam && !lastIsParam ? last.replace(/-/g, '_') : 'create';
  return method.toLowerCase();
}

function scopeOf(p: string): string {
  const s = p.replace(/^\/api\//, '');
  if (s.startsWith('dashboard/admin/')) return 'dash';
  if (s.startsWith('admin/')) return 'admin';
  if (s.startsWith('organizations/')) return 'tenant';
  return '';
}

function baseToolId(method: string, p: string): string {
  const s = p.replace(/^\/api\//, '');
  const domain = deriveDomain(s);
  return [domain, ...deriveSubpath(s, domain), deriveAction(method, p)].join('_');
}

/** All admin-scoped tool ids from the live spec. */
function adminIdsFromSpec(): string[] {
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as { paths: Record<string, Record<string, unknown>> };
  const exclude = ['/api/auth', '/api/csp-report', '/api/health', '/api/notifications/stream'];
  const eps: Array<{ method: string; path: string }> = [];
  for (const [p, methods] of Object.entries(spec.paths)) {
    if (exclude.some((e) => p.startsWith(e))) continue;
    for (const m of Object.keys(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(m)) continue;
      eps.push({ method: m.toUpperCase(), path: p });
    }
  }
  const baseCount = new Map<string, number>();
  for (const ep of eps) {
    const b = baseToolId(ep.method, ep.path);
    baseCount.set(b, (baseCount.get(b) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const ep of eps) {
    if (scopeOf(ep.path) !== 'admin') continue;
    const b = baseToolId(ep.method, ep.path);
    out.push((baseCount.get(b) ?? 0) > 1 ? `${b}_${scopeOf(ep.path)}` : b);
  }
  return out;
}

describe('ADMIN_TOOL_IDS stays in sync with the live spec (phase 2 task 5 step 3b)', () => {
  it('every admin-scoped tool id from openapi.json is in ADMIN_TOOL_IDS', () => {
    const missing = adminIdsFromSpec().filter((id) => !ADMIN_TOOL_IDS.has(id));
    expect(missing, `add these to src/mastra/tools/admin-tools.ts: ${missing.join(', ')}`).toEqual([]);
  });

  it('every entry in ADMIN_TOOL_IDS is an actual admin-scoped spec id (no stale ids)', () => {
    const specIds = new Set(adminIdsFromSpec());
    const stale = [...ADMIN_TOOL_IDS].filter((id) => !specIds.has(id));
    expect(stale, `remove these stale ids: ${stale.join(', ')}`).toEqual([]);
  });
});
