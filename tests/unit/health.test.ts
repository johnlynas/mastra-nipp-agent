import { describe, expect, it } from 'vitest';
import type { Mastra } from '@mastra/core/mastra';
import { checkHealthStatus } from '../../src/mastra/health';

const baseConfig = {
  ollamaBaseUrl: 'http://localhost:1', // not checked by /ai-agent-health
  ollamaModel: 'test',
  portalMcpUrl: 'http://localhost:4112/api/mcp/nipp-portal/mcp',
  mcpServerUrl: 'http://localhost:9999', // dead port → unhealthy
  portalUrl: 'http://localhost:9998', // dead port → unhealthy
};

describe('checkHealthStatus degraded (amber) semantics', () => {
  it('reports degraded, not unhealthy, when dependencies are down', async () => {
    const mastra = {} as Mastra; // storage check will fail → unhealthy check
    const health = await checkHealthStatus(mastra, baseConfig);
    expect(health.status).toBe('degraded');
    expect(health.checks.storage.status).toBe('unhealthy');
    expect(health.checks.mcpServer.status).toBe('unhealthy');
    expect(health.checks.portal.status).toBe('unhealthy');
    expect(health.checks.ollama).toBeUndefined();
  });

  it('skips the mcpServer check when it is not configured', async () => {
    const mastra = {} as Mastra;
    const health = await checkHealthStatus(mastra, { ...baseConfig, mcpServerUrl: '' });
    expect(health.checks.mcpServer.status).toBe('skipped');
  });

  it('skips the portal check when it is not configured', async () => {
    const mastra = {} as Mastra;
    const health = await checkHealthStatus(mastra, { ...baseConfig, portalUrl: '' });
    expect(health.checks.portal.status).toBe('skipped');
  });
});
