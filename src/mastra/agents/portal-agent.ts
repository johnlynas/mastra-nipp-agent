import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import type { MastraModelConfig } from '@mastra/core/llm';
import { loadConfig } from '../config';

const config = loadConfig();

/**
 * NIPP portal agent (DESIGN §4).
 *
 * PHASE 1: placeholder — minimal instructions, no tools yet.
 * Phase 2 adds the MCP smoke tool; Phase 5 replaces it with the 15 domain
 * tools and the full instruction set.
 */
export const portalAgent = new Agent({
  id: 'portal-agent',
  name: 'NIPP Portal Agent',
  instructions: 'You are the NIPP portal assistant.',
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
