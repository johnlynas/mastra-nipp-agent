import { betterAuth, type BetterAuthOptions } from 'better-auth/minimal';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-gen/client';

/**
 * Thin BetterAuth verification instance (DESIGN §5.5.3) — PHASE 3.
 *
 * Verification ONLY: it shares the portal's `BETTER_AUTH_SECRET` and the same
 * PostgreSQL database, so a session cookie minted by the portal at :3000 is
 * cryptographically valid here at :3001. No sign-in routes are mounted (the
 * portal owns those) — this instance exists so `MastraAuthBetterAuth` can call
 * `auth.api.getSession()` against incoming cookies, and so ban checks in
 * `authorizeUser` have a live DB to read user rows from.
 *
 * The Prisma client is generated from the portal's schema (prisma/schema.prisma,
 * copied verbatim from nipp-0111 — DESIGN §5.5.7 risk 9) and connects through
 * the pg driver adapter exactly like the portal does (Prisma 7 requires an
 * explicit driver adapter).
 */

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
  connectionTimeoutMillis: 5_000,
});

// Singleton on globalThis so Next.js dev hot-reload doesn't open a fresh pool
// per reload (same pattern as the portal's lib/db.ts).
const globalForPrisma = globalThis as unknown as { agentPrisma?: PrismaClient };

export const agentPrisma: PrismaClient =
  globalForPrisma.agentPrisma ?? new PrismaClient({ adapter });
globalForPrisma.agentPrisma = agentPrisma;

// Typed as the full BetterAuthOptions so `agentAuth` is `Auth<BetterAuthOptions>`
// — the exact type MastraAuthBetterAuth expects (narrowing to our literal config
// makes it structurally incompatible with the provider's generic bound).
const agentAuthOptions: BetterAuthOptions = {
  // Portal origin — the session cookie's base. Verification only reads cookies,
  // it never issues them, so this mainly keeps BetterAuth's URL handling sane.
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  secret: process.env.BETTER_AUTH_SECRET!, // MUST equal the portal's (risk 8)
  database: prismaAdapter(agentPrisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
};

export const agentAuth = betterAuth(agentAuthOptions);
