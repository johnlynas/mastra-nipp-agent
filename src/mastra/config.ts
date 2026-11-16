export interface AgentConfig {
  /** Ollama OpenAI-compatible Chat Completions endpoint */
  ollamaBaseUrl: string;
  /** Model ID (no `ollama/` prefix — added in code, DESIGN §4.1) */
  ollamaModel: string;
  /** Portal MCP server Streamable HTTP endpoint */
  portalMcpUrl: string;
  /** Base URL of the portal MCP server (health probe target: {url}/mcp-health) */
  mcpServerUrl: string;
  /** Base URL of the NIPP portal (health probe target: {url}/api/health) */
  portalUrl: string;
}

/**
 * Reads agent configuration from environment variables with defaults
 * (DESIGN §9.1). Centralized so every consumer gets the same values.
 */
export function loadConfig(): AgentConfig {
  return {
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
    ollamaModel: process.env.OLLAMA_MODEL ?? 'Swift-Qwen3.8-27B-Q4_K_S:latest',
    portalMcpUrl:
      process.env.PORTAL_MCP_URL ?? 'http://localhost:4112/api/mcp/nipp-portal/mcp',
    mcpServerUrl: (process.env.MCP_SERVER_URL ?? 'http://localhost:4112').replace(/\/+$/, ''),
    portalUrl: (process.env.PORTAL_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  };
}
