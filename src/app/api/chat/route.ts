import { NextResponse } from 'next/server';
import { handleChatStream } from '@mastra/ai-sdk';
import { createUIMessageStreamResponse } from 'ai';
import { RequestContext } from '@mastra/core/request-context';
import { mastra } from '@/mastra';
import { getPortalSessionUser } from '@/lib/auth-client';

/**
 * Streaming chat endpoint (PHASE 6, DESIGN §5.5.2/§6.2).
 *
 * Browser → POST /api/chat (portal session cookie) → handleChatStream →
 * portalAgent → domain tools → MCP server → portal API. The response is an
 * AI SDK v7 UI message stream consumed by `useChat` in src/app/chat/page.tsx.
 *
 * Auth is enforced HERE, not just by the Mastra server adapter (acceptance
 * criterion: POST /api/chat without cookie → 401). This route is a plain Next
 * route — it never passes through `MastraAuthBetterAuth` — so it verifies the
 * shared portal session itself via getPortalSessionUser() (same ban check as
 * authorizeUser in src/mastra/index.ts).
 *
 * Memory scoping mirrors the verified Phase 3 flow: one thread per user
 * (thread = user id) and `mastra__resourceId` set to the user id, which is what
 * tools/dispatch.ts reads to inject the caller's activeOrganizationId as the
 * default orgId (DESIGN §5.5.4). The client-supplied body is NOT trusted for
 * any of this — only messages/trigger/resumeData are read from it.
 */

const AGENT_ID = 'portal-agent';

export async function POST(req: Request) {
  const user = await getPortalSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(b.messages)) {
    return NextResponse.json({ error: 'messages must be an array' }, { status: 400 });
  }

  // Trusted context built from the verified session — never from the body.
  const requestContext = new RequestContext();
  requestContext.set('mastra__resourceId', user.id);

  const stream = await handleChatStream({
    mastra,
    agentId: AGENT_ID,
    version: 'v7', // matches ai@7 / @ai-sdk/react@4 installed here
    params: {
      messages: b.messages as never[],
      requestContext,
      ...(typeof b.trigger === 'string' &&
      (b.trigger === 'submit-message' || b.trigger === 'regenerate-message')
        ? { trigger: b.trigger }
        : {}),
      ...(b.resumeData && typeof b.resumeData === 'object'
        ? { resumeData: b.resumeData as Record<string, unknown> }
        : {}),
    },
    defaultOptions: {
      memory: { thread: user.id }, // per-user thread; resource resolves from mastra__resourceId above
      maxSteps: 10,
    },
  });

  // handleChatStream returns an OBJECT stream of UI message chunks — it must be
  // serialized to SSE before returning (a raw Response(stream) writes objects and
  // crashes with ERR_INVALID_ARG_TYPE). createUIMessageStreamResponse does that.
  // The V7 chunk type from @mastra/ai-sdk is structurally the same as ai@7's
  // UIMessageChunk except for a FinishReason union widening, hence the cast.
  return createUIMessageStreamResponse({ stream: stream as unknown as ReadableStream<never> });
}
