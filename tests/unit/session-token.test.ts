import { describe, expect, it, vi } from 'vitest';

// The auth module opens a Prisma pool + BetterAuth instance at import time —
// mock both deps so the test runs without DATABASE_URL.
vi.mock('@/mastra/auth', () => ({
  agentAuth: {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => ({
        user: { id: 'u_1', name: 'T', email: 't@x.io' },
        _capturedHeaders: headers,
      }),
    },
  },
  agentPrisma: {
    user: { findUnique: async () => ({ banned: false, banExpires: null }) },
  },
}));

import { getPortalSessionUser } from '@/lib/auth-client';

describe('getPortalSessionUser — session token exposure (phase 1 task 6)', () => {
  it('returns the bearer token when the bearer door is used', async () => {
    const user = await getPortalSessionUser(
      new Request('http://localhost:3001/api/chat', {
        headers: { authorization: 'Bearer tok-abc' },
      })
    );
    expect(user?.id).toBe('u_1');
    expect(user?.sessionToken).toBe('tok-abc');
  });

  it('returns the session cookie value for the cookie door', async () => {
    const user = await getPortalSessionUser(
      new Request('http://localhost:3001/api/chat', {
        headers: { cookie: '__Secure-better-auth.session_token=tok-cookie' },
      })
    );
    expect(user?.id).toBe('u_1');
    expect(user?.sessionToken).toBe('tok-cookie');
  });

  it('returns the plain (non-secure) cookie value when present', async () => {
    const user = await getPortalSessionUser(
      new Request('http://localhost:3001/api/chat', {
        headers: { cookie: 'better-auth.session_token=tok-plain' },
      })
    );
    expect(user?.sessionToken).toBe('tok-plain');
  });

  it('returns no user (and no token) for an invalid session', async () => {
    const { agentAuth } = await import('@/mastra/auth');
    const original = (agentAuth.api as any).getSession;
    (agentAuth.api as any).getSession = async () => null;
    try {
      const user = await getPortalSessionUser(
        new Request('http://localhost:3001/api/chat', { headers: { authorization: 'Bearer tok-bad' } })
      );
      expect(user).toBeNull();
    } finally {
      (agentAuth.api as any).getSession = original;
    }
  });
});
