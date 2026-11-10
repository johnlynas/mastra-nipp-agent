import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { portalAgent } from './agents/portal-agent';

/**
 * Mastra instance (DESIGN §6.2).
 *
 * PHASE 1: placeholder agent + LibSQL storage, no auth yet.
 * Phase 3 wires MastraAuthBetterAuth (shared portal session) on the server.
 */
export const mastra = new Mastra({
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: 'file:/Users/johnlynas/dev/mastra-nipp-agent/mastra.db',
  }),
  agents: { portalAgent },
});
