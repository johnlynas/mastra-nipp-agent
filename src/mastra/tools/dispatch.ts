import { portalMcp } from '../mcp/client';
import { agentPrisma } from '../auth';
import { loadConfig } from '../config';

/**
 * Shared MCP dispatcher (DESIGN §3.3, Phase 5 step 1).
 *
 * Every domain tool funnels through `callMcpTool(toolId, input)`. This module:
 *   1. Resolves the target MCP tool by its raw id (namespaced `<server>_<tool>`),
 *      reading the live tool list + JSON schemas from `listTools()` ONCE and
 *      caching them (DESIGN §5 — "read its schema once at startup; cache it").
 *   2. Injects `orgId` defaulting to the caller's `activeOrganizationId` when
 *      omitted (DESIGN §5.5.4) — this is what scopes a signed-in user's view to
 *      their own tenant: the MCP server forwards `orgId` as the `x-org-id` header
 *      and the portal's RLS enforces it.
 *   3. Filters the input down to the fields the target tool actually accepts.
 *      The generated MCP tools use `additionalProperties: false`, so an extra
 *      field would be rejected at the client validation layer before it ever
 *      reaches the portal — filtering is mandatory, not just tidy.
 *   4. Normalizes the result / errors into `{ success, status?, data?, error? }`
 *      with human-readable messages (401 → "session expired", refused → server
 *      down hint). No raw stack traces reach the model or the user.
 */

/** Server key in the MCPClient config — listTools() namespaces as `<key>_<tool>`. */
const SERVER = 'nippPortal';

/** The reserved request-context key Mastra sets to the mapped resource id, which
 *  `mapUserToResourceId` (src/mastra/index.ts) resolves to the caller's user id. */
const RESOURCE_ID_KEY = 'mastra__resourceId';

type McpToolHandle = { execute?: (input: unknown, ctx?: unknown) => Promise<unknown> };
type JsonSchema = { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };

interface RegistryEntry {
  handle: McpToolHandle;
  schema: JsonSchema;
}

/** Loose request-context shape — only what we read. Keeps dispatch testable. */
export interface RequestContextLike {
  get?: (key: string) => unknown;
}

export interface DispatchResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

interface Registry {
  map: Map<string, RegistryEntry>;
  /** Per-server discovery errors (present when a server is unreachable). */
  errors: Record<string, string>;
}

let registryPromise: Promise<Registry> | null = null;

/** Clear the cached tool registry (drift recovery + tests). */
export function invalidateMcpToolCache(): void {
  registryPromise = null;
}

/** Read a tool's JSON input schema from its StandardSchema wrapper. */
function readSchema(tool: unknown): JsonSchema {
  try {
    const js = (tool as { inputSchema?: { '~standard'?: { jsonSchema?: { input?: (o: { target: string }) => JsonSchema } } } }).inputSchema?.['~standard']?.jsonSchema;
    if (!js || typeof js.input !== 'function') return {};
    return js.input({ target: 'draft-2020-12' });
  } catch {
    return {};
  }
}

/** Load (and cache) the live MCP tool list + schemas, once per process. */
async function loadRegistry(): Promise<Registry> {
  if (!registryPromise) {
    registryPromise = (async () => {
      const { tools, errors } = await portalMcp.listToolsWithErrors();
      const map = new Map<string, RegistryEntry>();
      for (const [nsId, tool] of Object.entries(tools)) {
        map.set(nsId, { handle: tool as McpToolHandle, schema: readSchema(tool) });
      }
      return { map, errors };
    })();
  }
  return registryPromise;
}

/** Resolve the caller's active organization id from their verified session.
 *  Fails open (returns undefined → MCP server defaults to Platform org): by the
 *  time a tool runs, authorizeUser already read this row successfully, and the
 *  portal's own RBAC/RLS is the real security boundary (DESIGN §5.5.4). */
async function resolveCallerOrgId(rc: RequestContextLike | undefined): Promise<string | undefined> {
  const userId = rc?.get?.(RESOURCE_ID_KEY);
  if (typeof userId !== 'string' || !userId) return undefined;
  try {
    const u = await agentPrisma.user.findUnique({
      where: { id: userId },
      select: { activeOrganizationId: true },
    });
    return u?.activeOrganizationId ?? undefined;
  } catch {
    return undefined;
  }
}

/** Unwrap the MCP content envelope `{ content: [{ type:'text', text:'<json>' }] }`
 *  into the portal's own `{ success, status, data | error }` payload. */
function extractPayload(raw: unknown): DispatchResult {
  if (raw && typeof raw === 'object') {
    const r = raw as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
    if (Array.isArray(r.content)) {
      const text = r.content
        .filter((c) => c?.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text as string)
        .join('\n');
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        return {
          success: parsed.success !== false,
          status: toNumber(parsed.status),
          data: 'data' in parsed ? parsed.data : parsed,
          error: typeof parsed.error === 'string' ? parsed.error : undefined,
        };
      } catch {
        // Non-JSON tool output — surface the text.
        return r.isError ? { success: false, error: text || 'MCP tool returned an error.' } : { success: true, data: text };
      }
    }
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    return {
      success: o.success !== false,
      status: toNumber(o.status),
      data: 'data' in o ? o.data : o,
      error: typeof o.error === 'string' ? o.error : undefined,
    };
  }
  return { success: true, data: raw };
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

/** Map a thrown error to a readable, user-safe message. */
function normalizeError(e: unknown): DispatchResult {
  const msg = e instanceof Error ? e.message : String(e);
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|ETIMEDOUT|socket hang up|network|timeout/i.test(msg)) {
    return { success: false, error: `Portal MCP server not reachable at ${loadConfig().portalMcpUrl}. Is mastra-nipp-mcp running? (${msg})` };
  }
  if (/401|unauthorized|not authenticated|session (expired|invalid)/i.test(msg)) {
    return { success: false, status: 401, error: 'Portal session expired — sign in to the portal again.' };
  }
  return { success: false, error: msg };
}

/**
 * Dispatch a domain action to a specific MCP tool.
 *
 * @param toolId  Raw MCP tool id WITHOUT the server prefix (e.g. `wo_list`).
 * @param input   Action params from the model (any shape; filtered below).
 * @param opts    Optional — pass the tool invocation's `requestContext` so the
 *                caller's active org can be used as the default `orgId`.
 */
export async function callMcpTool(
  toolId: string,
  input: Record<string, unknown> | undefined,
  opts: { requestContext?: RequestContextLike } = {},
): Promise<DispatchResult> {
  const nsId = `${SERVER}_${toolId}`;

  let registry = await loadRegistry();
  let entry = registry.map.get(nsId);

  // Drift recovery: if the tool isn't in the cached list, reload once and retry.
  if (!entry) {
    invalidateMcpToolCache();
    registry = await loadRegistry();
    entry = registry.map.get(nsId);
  }

  if (!entry || typeof entry.handle.execute !== 'function') {
    const serverErr = registry.errors[SERVER];
    if (serverErr) {
      return { success: false, error: `Portal MCP server not reachable at ${loadConfig().portalMcpUrl}. Is mastra-nipp-mcp running? (${serverErr})` };
    }
    return { success: false, error: `MCP tool '${toolId}' not found on the portal server (expected ${nsId}).` };
  }

  const props = entry.schema.properties ?? {};

  // 1) orgId default injection — only when the tool accepts orgId and it's omitted.
  let payload: Record<string, unknown> = { ...(input ?? {}) };
  if (props.orgId !== undefined && payload.orgId === undefined) {
    const callerOrg = await resolveCallerOrgId(opts.requestContext);
    if (callerOrg) payload.orgId = callerOrg;
  }

  // 2) Filter to accepted fields (drop undefined + anything not in the schema).
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) continue;
    if (props[k] !== undefined) filtered[k] = v;
  }

  try {
    const raw = await entry.handle.execute(filtered, undefined);
    return extractPayload(raw);
  } catch (e) {
    return normalizeError(e);
  }
}
