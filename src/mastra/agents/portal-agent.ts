import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import type { MastraModelConfig } from '@mastra/core/llm';
import { loadConfig } from '../config';
import { portalSmokeTool } from '../tools/smoke-tool';

const config = loadConfig();

/**
 * NIPP portal agent (DESIGN §4).
 *
 * PHASE 2: placeholder instructions + the MCP smoke tool (canary for the
 * agent → MCPClient → MCP server → portal bridge). Phase 5 replaces the smoke
 * tool with the 15 domain tools and the full instruction set.
 */
export const portalAgent = new Agent({
  id: 'portal-agent',
  name: 'NIPP Portal Agent',
  instructions: [
    'You are the NIPP portal assistant, an administrator helper for the NIPP property-management portal.',
    'You can reach the live portal through the portal_smoke tool, which checks portal health and the MCP bridge session.',
    'When asked to check portal health or the connection, call portal_smoke and report its result plainly.',
    'If a tool returns { success: false }, relay the error message to the user verbatim — do not invent results.',
  ].join('\n'),
  tools: { portalSmokeTool },
  model: {
    id: `ollama/${config.ollamaModel}`,
    url: config.ollamaBaseUrl,
    apiKey: 'ollama', // placeholder — Ollama ignores it
    api: 'chat', // Chat Completions (NOT Responses API)
  } as MastraModelConfig,
  memory: new Memory({
    options: {
      // workingMemory left off for v1 — observational/working memory adds
      // latency on a local model; revisit if context management needs it.
    },
  }),
});
