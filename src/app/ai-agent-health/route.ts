import { mastra } from '@/mastra';
import { loadConfig } from '@/mastra/config';
import { checkHealthStatus, buildHealthResponse } from '@/mastra/health';

/**
 * Public health endpoint for the AI agent server (GET /ai-agent-health).
 *
 * Root-level Next.js route (like the MCP server's root /mcp-health) — Mastra is
 * embedded under /api/mastra/* here, so a plain App Router route is how we keep
 * the probe at the server root. No authentication: polled by the APM, which
 * alerts on red and can restart the server; amber (degraded) is a warning only.
 *
 * Dependency semantics mirror the portal's PgBouncer pooler — nice to have, the
 * service keeps working without it — so any failing check degrades to amber:
 *   - storage:    the agent server's own LibSQL store
 *   - mcpServer:  the portal MCP server's /mcp-health (agent depends on it for
 *                 portal tools, but the server itself stays up and answering)
 *   - portal:     the NIPP portal's public /api/health
 *
 * A dead process is the only red state — the APM sees an unreachable endpoint,
 * not a JSON status. So this answers 200 for healthy/degraded, 503 only if a
 * check were ever classified critical (none currently).
 */
export async function GET() {
  const health = await checkHealthStatus(mastra, loadConfig());
  return buildHealthResponse(health);
}
