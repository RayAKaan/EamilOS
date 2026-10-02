import { describe, expect, it } from 'vitest';
import { AgentInstaller } from './AgentInstaller.js';
import { UNIVERSAL_AGENT_CATALOG } from './catalog.js';

describe('AgentInstaller', () => {
  it('produces deterministic plans without executing installers', async () => {
    const installer = new AgentInstaller();
    const agent = UNIVERSAL_AGENT_CATALOG.find((item) => item.id === 'opencode')!;
    const result = await installer.install(agent, { dryRun: true });
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.message).toContain('npm install -g');
  });

  it('never auto-executes remote scripts', async () => {
    const installer = new AgentInstaller();
    const agent = UNIVERSAL_AGENT_CATALOG.find((item) => item.installation.strategy === 'script')!;
    const result = await installer.install(agent);
    expect(result.success).toBe(false);
    expect(result.message).toContain('never executed automatically');
  });
});
