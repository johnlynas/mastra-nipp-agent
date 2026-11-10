import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { MastraAuthBetterAuth } from '@mastra/auth-better-auth';
import { portalAgent } from './agents/portal-agent';
import { agentAuth, agentPrisma } from './auth';

/**
 * Mastra instance (DESIGN §6.2) — PHASE 3: BetterAuth shared-session auth.
 *
 * The server verifies the portal's session cookie on every request
 * (`MastraAuthBetterAuth` + the thin `agentAuth` instance in ./auth.ts).
 * A cookie minted by the portal at :3000 is valid here because both apps
 * share BETTER_AUTH_SECRET and the same PostgreSQL database.
 */

const mastraAuth = new MastraAuthBetterAuth({
  auth: agentAuth,
  // Everything under /api/* is protected by default (Mastra server default).
  // These stay open; there is no sign-in in this app — unauthenticated users
  // are redirected to the portal's login page from the chat UI.
  public: ['/health'],
  // Memory/thread scoping: one thread per portal user (DESIGN §5.5.4).
  mapUserToResourceId: (user) => user?.user?.id,
  // v1 gate: any authenticated, non-banned portal user (DESIGN §5.5.3).
  // The ban flag is a custom User column — BetterAuth's getSession() returns
  // only the base user shape, so we read the live row via agentPrisma
  // (mirrors the portal's enforceBanStatus semantics: an active ban rejects;
  // an expired ban is treated as lifted — the portal lifts the flag itself on
  // the user's next sign-in; we only verify, never write).
  async authorizeUser(user) {
    const id = user?.user?.id;
    if (!id) return false;
    try {
      const u = await agentPrisma.user.findUnique({
        where: { id },
        select: { banned: true, banExpires: true },
      });
      if (u?.banned && !(u.banExpires && new Date(u.banExpires) < new Date())) {
        return false;
      }
    } catch {
      // DB unavailable: fail closed — a session we cannot re-verify is rejected.
      return false;
    }
    return true;
  },
});

export const mastra = new Mastra({
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: 'file:/Users/johnlynas/dev/mastra-nipp-agent/mastra.db',
  }),
  agents: { portalAgent },
  server: {
    auth: mastraAuth,
    // Portal origin may call the Mastra API cross-origin with cookies
    // (chat UI at :3001 is same-origin; Studio / programmatic calls from the
    // portal at :3000 need credentials CORS). DESIGN §5.5.3.
    cors: {
      origin: 'http://localhost:3000',
      credentials: true,
    },
  },
});
