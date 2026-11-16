import { mastra } from '@/mastra';
import { checkHealthStatus, buildHealthResponse } from '@/mastra/health';

/**
 * Public health endpoint for the AI agent server (GET /ai-agent-health).
 *
 * Root-level Next.js route (like the MCP server's root /mcp-health) — Mastra is
 * embedded under /api/mastra/* here, so a plain App Router route is how we keep
 * the probe at the server root. No authentication: polled by the APM, which
 * alerts on red and can restart the server; amber (degraded) is a warning only.
 *
 * The single dependency check mirrors the portal's PgBouncer pooler semantics —
 * nice to have, the service keeps working without it — so a failing check
 * degrades to amber:
 *   - storage:    the agent server's own LibSQL store
 *
 * A dead process is the only red state — the APM sees an unreachable endpoint,
 * not a JSON status. So this answers 200 for healthy/degraded, 503 only if a
 * check were ever classified critical (none currently).
 */
export async function GET() {
  const health = await checkHealthStatus(mastra);
  return buildHealthResponse(health);
}
