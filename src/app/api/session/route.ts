import { NextResponse } from 'next/server';
import { getPortalSessionUser } from '@/lib/auth-client';

/**
 * Same-origin session check for the chat UI (PHASE 6).
 *
 * The portal's BetterAuth API is not CORS-open to :3001, so the client cannot
 * call it directly — this route verifies the shared session cookie server-side
 * instead (see src/lib/auth-client.ts). 200 + { user } when signed in, 401
 * otherwise. The chat page polls it on mount and after any 401 from /api/chat.
 */
export async function GET(req: Request) {
  const user = await getPortalSessionUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ user });
}
