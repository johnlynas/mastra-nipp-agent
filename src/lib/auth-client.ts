/**
 * Portal session helpers for the chat UI (DESIGN §5.5.3 / §5.5.5) — PHASE 6.
 *
 * DESIGN's sketch used a client-side `better-auth/react` instance pointed at the
 * portal origin. That does not work in this deployment: the portal's BetterAuth
 * instance has no `trustedOrigins` entry for :3001, so its `/api/auth/*` routes
 * send NO CORS headers (verified 2026-11-11) and the browser blocks any
 * cross-origin fetch from the chat page.
 *
 * The BetterAuth session cookie is host-scoped (`localhost`), so the same cookie
 * the portal sets at :3000 is ALSO sent to this app at :3001 — which is exactly
 * how `MastraAuthBetterAuth` verifies it on the Mastra server (Phase 3). The
 * chat UI therefore checks the session SERVER-SIDE, same-origin:
 *
 *   GET /api/session  →  { user }        (200, valid portal session)
 *                       →  401           (no/invalid/expired/banned session)
 *
 * Login itself stays in the portal — the sign-in banner links to
 * `${NEXT_PUBLIC_PORTAL_URL}/login?callbackUrl=/chat` (the portal's login page
 * reads `callbackUrl` and redirects back after signing in).
 */

import { agentAuth, agentPrisma } from '@/mastra/auth';

export { PORTAL_URL, portalLoginUrl } from './portal-url';

/** Minimal identity shape exposed to the client. No session tokens, no org ids. */
export interface PortalSessionUser {
  id: string;
  name?: string;
  email?: string;
  /**
   * The caller's portal session token (bearer). Server-side only — never sent
   * to the browser. Phase 1 MCP authz: /api/chat puts it in requestContext as
   * `mastra__portalSessionToken` so every MCP tool call executes under the
   * calling user's own portal session, not the MCP server's service account.
   */
  sessionToken?: string;
}

/** Read a single cookie value from a raw `Cookie:` header (null if absent). */
function parseCookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Verify the caller's portal session on a same-origin request (server side).
 * Mirrors `authorizeUser` in src/mastra/index.ts: valid session + active-ban
 * check against the live User row (fail-closed on DB error).
 *
 * Two doors, in order:
 *  1. Bearer header — `Authorization: Bearer <portal session token>` (the
 *     primary door for the admin-dashboard embed; see bearer() in
 *     src/mastra/auth.ts). The plugin rewrites it to a session cookie before
 *     getSession runs, so no extra handling is needed here.
 *  2. Session cookie — direct browser access to /chat. In production the
 *     portal mints `__Secure-better-auth.session_token` (useSecureCookies),
 *     but this instance resolves the non-secure name over plain HTTP — so we
 *     copy the secure-prefixed value onto the name getSession() actually reads.
 *     Without this, cookie auth works in dev (plain name) and silently 401s
 *     in production (prefixed name), which is exactly the "agent not rendered"
 *     bug.
 */
export async function getPortalSessionUser(
  req: Request,
): Promise<PortalSessionUser | null> {
  const headers = new Headers(req.headers);

  // Phase 1 MCP authz: capture the caller's raw session token from whichever
  // door is carrying it (bearer header value, or the session cookie value).
  // It rides along in requestContext and reaches the MCP transport fetch hook.
  let sessionToken = '';
  const bearerHeader = headers.get('authorization');
  if (bearerHeader) {
    const m = bearerHeader.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) sessionToken = m[1].trim();
  }

  // Cookie-name normalization (door 2 above) — only when the bearer door is
  // not already carrying the session. The web Request has no .cookies, so read
  // the raw Cookie header directly.
  if (!headers.get('authorization')) {
    const cookieHeader = headers.get('cookie') ?? '';
    const secureCookie = parseCookieValue(cookieHeader, '__Secure-better-auth.session_token');
    if (secureCookie && !parseCookieValue(cookieHeader, 'better-auth.session_token')) {
      headers.set('cookie', `better-auth.session_token=${secureCookie}`);
    }
    sessionToken =
      parseCookieValue(headers.get('cookie') ?? '', 'better-auth.session_token') ?? '';
  }

  let result: { user?: { id: string; name?: string; email?: string } } | null = null;
  try {
    result = await agentAuth.api.getSession({ headers });
  } catch {
    return null; // cookie unreadable / secret mismatch → treat as signed out
  }
  const user = result?.user;
  if (!user?.id) return null;

  try {
    const u = await agentPrisma.user.findUnique({
      where: { id: user.id },
      select: { banned: true, banExpires: true },
    });
    if (u?.banned && !(u.banExpires && new Date(u.banExpires) < new Date())) {
      return null; // active ban → signed out (same rule as authorizeUser)
    }
  } catch {
    return null; // fail closed, same as authorizeUser
  }

  return { id: user.id, name: user.name, email: user.email, sessionToken: sessionToken || undefined };
}
