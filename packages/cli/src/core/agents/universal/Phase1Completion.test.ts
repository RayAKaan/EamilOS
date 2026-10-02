import { describe, expect, it } from 'vitest';
import { UNIVERSAL_AGENT_CATALOG } from './catalog.js';
import { CapabilityMatcher } from './CapabilityMatcher.js';
import { InstallationPlanner } from './InstallationPlanner.js';
import { AuthenticationManager } from './AuthenticationManager.js';
import { createLaunchContract } from './AgentLaunchContract.js';
import { UniversalAgentRegistry } from './UniversalAgentRegistry.js';

describe('Phase 1 completion contracts', () => {
  it('has a unique, executable contract for every worker', () => {
    expect(UNIVERSAL_AGENT_CATALOG).toHaveLength(35);
    for (const agent of UNIVERSAL_AGENT_CATALOG) {
      expect(agent.id).toBeTruthy();
      expect(agent.executableCandidates.length).toBeGreaterThan(0);
      expect(agent.versionArgs.length).toBeGreaterThan(0);
      expect(agent.protocols.length).toBeGreaterThan(0);
      expect(agent.platforms.length).toBeGreaterThan(0);
      expect(agent.installation.strategy).toBeTruthy();
    }
  });

  it('produces deterministic launch contracts', () => {
    const kilo = UNIVERSAL_AGENT_CATALOG.find(agent => agent.id === 'kilo-code')!;
    const contract = createLaunchContract(kilo, { id: 't', sessionId: 's', prompt: 'run tests', systemPrompt: '', mode: 'execution', workingDir: process.cwd(), timeoutMs: 1000 });
    expect(contract.executable).toBe('kilo');
    expect(contract.args).toEqual(['run', '--auto', 'run tests']);
    expect(contract.promptDelivery).toBe('argv');
  });

  it('plans safe automated installation without remote script execution', () => {
    const planner = new InstallationPlanner();
    const kilo = planner.plan(UNIVERSAL_AGENT_CATALOG.find(agent => agent.id === 'kilo-code')!);
    expect(kilo.commands[0].args).toContain('@kilocode/cli');
    const kimi = planner.plan(UNIVERSAL_AGENT_CATALOG.find(agent => agent.id === 'kimi-code')!);
    expect(kimi.supported).toBe(false);
    expect(kimi.manualAction).toContain('remote scripts');
  });

  it('does not expose credentials during auth inspection', () => {
    const manager = new AuthenticationManager();
    const result = manager.inspect(UNIVERSAL_AGENT_CATALOG.find(agent => agent.id === 'codex-cli')!);
    expect(result.detail).not.toContain(process.env.OPENAI_API_KEY ?? '__unset__');
  });

  it('matches a capable worker while respecting forbidden capabilities', () => {
    const matcher = new CapabilityMatcher();
    const result = matcher.select(UNIVERSAL_AGENT_CATALOG, { all: ['codeGeneration'], none: ['remoteExecution'], preferredAgentIds: ['opencode'] });
    expect(result).toBeDefined();
    expect(result?.agent.capabilities.remoteExecution).toBe(false);
  });

  it('can detect all definitions without executing prompts', async () => {
    const registry = new UniversalAgentRegistry();
    const result = await registry.detectAll({ timeoutMs: 50 });
    expect(result).toHaveLength(35);
    expect(result.every(item => typeof item.installed === 'boolean')).toBe(true);
  });
});
