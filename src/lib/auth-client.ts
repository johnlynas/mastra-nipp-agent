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
}

/**
 * Verify the portal session cookie on a same-origin request (server side).
 * Mirrors `authorizeUser` in src/mastra/index.ts: valid session + active-ban
 * check against the live User row (fail-closed on DB error).
 */
export async function getPortalSessionUser(
  req: Request,
): Promise<PortalSessionUser | null> {
  const headers = new Headers(req.headers);
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

  return { id: user.id, name: user.name, email: user.email };
}
