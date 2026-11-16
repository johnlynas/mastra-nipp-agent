import { describe, expect, it } from 'vitest';
import type { Mastra } from '@mastra/core/mastra';
import { checkHealthStatus } from '../../src/mastra/health';

describe('checkHealthStatus degraded (amber) semantics', () => {
  it('reports degraded, not unhealthy, when storage is down', async () => {
    const mastra = {} as Mastra; // storage check will fail → unhealthy check
    const health = await checkHealthStatus(mastra);
    expect(health.status).toBe('degraded');
    expect(health.checks.storage.status).toBe('unhealthy');
    expect(health.checks.mcpServer).toBeUndefined();
    expect(health.checks.portal).toBeUndefined();
  });

  it('reports healthy when storage is up', async () => {
    const mastra = {
      getStorage: () => ({
        getStore: () => Promise.resolve({ list: async () => [] }),
      }),
    } as unknown as Mastra;
    const health = await checkHealthStatus(mastra);
    expect(health.status).toBe('healthy');
    expect(health.checks.storage.status).toBe('healthy');
  });

  it('reports healthy when storage is not configured (skipped)', async () => {
    const mastra = { getStorage: () => undefined } as unknown as Mastra;
    const health = await checkHealthStatus(mastra);
    expect(health.status).toBe('healthy');
    expect(health.checks.storage.status).toBe('skipped');
  });
});
