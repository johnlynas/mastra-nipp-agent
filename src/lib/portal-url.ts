/**
 * Client-safe portal URL helpers (PHASE 6).
 *
 * Kept free of any server imports so the chat page (a client component) can
 * import it without dragging Prisma/BetterAuth into the browser bundle.
 * `src/lib/auth-client.ts` re-exports these for server-side routes.
 */

export const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3000';

/** Where the banner's "Sign in" button points (the portal owns sign-in).
 *  The callback returns to the portal's AI Agent page — the chat UI is an
 *  iframe inside it, so /chat (an agent path) would 404 on the portal. */
export function portalLoginUrl(): string {
  return `${PORTAL_URL}/login?callbackUrl=/dashboard/admin/agent`;
}
