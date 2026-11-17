import { portalAgent } from '../src/mastra/agents/portal-agent';

// Workspace tools resolve per-request (not via static listTools()).
const tools = await portalAgent.listWorkspaceTools({
  getModel: () => portalAgent.getModel(),
});
const names = Object.keys(tools).sort();
console.log('workspace tools:', names.join(', '));

// Prove the filesystem works end-to-end through the provider.
const ws = (await portalAgent.getWorkspace())!;
const fs = await ws.resolveFilesystem({});
await fs.writeFile('smoke-test.txt', 'hello from smoke test');
console.log('read back:', (await fs.readFile('smoke-test.txt')) as string);
await fs.deleteFile('smoke-test.txt');

// Containment: absolute path outside basePath must be rejected.
try {
  await fs.readFile('/etc/hostname');
  console.log('CONTAINMENT FAIL: external read was allowed');
} catch (e) {
  console.log('containment OK:', (e as Error).constructor.name);
}
