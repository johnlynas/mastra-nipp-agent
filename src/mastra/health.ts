/**
 * Public health endpoint for the AI agent server (GET /ai-agent-health).
 *
 * Modeled on the MCP server's public probe (mastra-nipp-mcp src/mastra/health.ts):
 * JSON body with status / timestamp / uptime / per-dependency checks. No
 * authentication — polled by the APM, which alerts on red and can restart the
 * server; amber is a warning only.
 *
 * Dependency semantics (mirrors how the portal treats its PgBouncer pooler —
 * nice to have, the service keeps working without it):
 *   - storage:    the agent server's own LibSQL store → degraded when down
 *   - mcpServer:  the portal MCP server's /mcp-health → degraded when down
 *                 (the agent depends on it for portal tools, but the server
 *                 itself stays up and answering probes)
 *
 * A dead process is the only red state — the APM sees it as an unreachable
 * endpoint, not a JSON status. So this route answers 200 for healthy/degraded
 * and 503 only if we ever classify a check as critical (none currently).
 */
import type { Mastra } from '@mastra/core/mastra';
import type { AgentConfig } from './config';

type CheckResult = {
  status: 'healthy' | 'unhealthy' | 'skipped';
  latency_ms?: number;
  error?: string;
  message?: string;
};

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: Record<string, CheckResult>;
}

const DEPENDENCY_TIMEOUT_MS = 5_000;

/** Probe the agent server's LibSQL store with a trivial list query. */
async function checkStorage(mastra: Mastra): Promise<CheckResult> {
  const start = Date.now();
  try {
    const agentsStore = await mastra.getStorage()?.getStore('agents');
    if (!agentsStore) {
      return { status: 'skipped', message: 'Storage not configured' };
    }
    await agentsStore.list();
    return { status: 'healthy', latency_ms: Date.now() - start };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: `Storage query failed (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

/** Probe the portal MCP server's own public health endpoint (no auth). */
async function checkMcpServer(mcpServerUrl: string): Promise<CheckResult> {
  if (!mcpServerUrl) {
    return { status: 'skipped', message: 'MCP server not configured' };
  }
  const start = Date.now();
  try {
    const res = await fetch(`${mcpServerUrl.replace(/\/+$/, '')}/mcp-health`, {
      signal: AbortSignal.timeout(DEPENDENCY_TIMEOUT_MS),
    });
    if (!res.ok) {
      let detail: unknown;
      try {
        const body = (await res.json()) as { status?: string };
        detail = body.status ?? res.status;
      } catch {
        detail = res.status;
      }
      return {
        status: 'unhealthy',
        latency_ms: Date.now() - start,
        error: `MCP server reported unhealthy (status ${detail})`,
      };
    }
    return { status: 'healthy', latency_ms: Date.now() - start };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: `MCP server unreachable (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

/** Run all health checks — returns current state only, no side effects. */
export async function checkHealthStatus(
  mastra: Mastra,
  config: AgentConfig,
): Promise<HealthResponse> {
  const [storage, mcpServer] = await Promise.all([
    checkStorage(mastra),
    checkMcpServer(config.mcpServerUrl),
  ]);

  // All dependencies are non-critical (amber) — the agent server process is up
  // and answering probes even if they fail. A dead process never reaches this code.
  const status: HealthResponse['status'] =
    storage.status === 'unhealthy' || mcpServer.status === 'unhealthy'
      ? 'degraded'
      : 'healthy';

  const checks: Record<string, CheckResult> = { storage, mcpServer };
  if (status !== 'healthy') {
    console.warn(`[HEALTH] ${status}: ${JSON.stringify(checks)}`);
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    checks,
  };
}

/** Serialize a health response for the HTTP layer (200 healthy/degraded, 503 unhealthy). */
export function buildHealthResponse(health: HealthResponse): Response {
  return new Response(JSON.stringify(health), {
    status: health.status === 'unhealthy' ? 503 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
