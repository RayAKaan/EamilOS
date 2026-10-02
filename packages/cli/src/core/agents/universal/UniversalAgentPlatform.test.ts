import { describe, expect, it } from 'vitest';
import { CapabilityMatcher } from './CapabilityMatcher.js';
import { UNIVERSAL_AGENT_CATALOG } from './catalog.js';
import { UniversalAgentRegistry } from './UniversalAgentRegistry.js';
import { AuthenticationManager } from './AuthenticationManager.js';

describe('Universal agent platform', () => {
  it('contains exactly 35 worker definitions', () => {
    expect(UNIVERSAL_AGENT_CATALOG).toHaveLength(35);
    expect(new Set(UNIVERSAL_AGENT_CATALOG.map((agent) => agent.id)).size).toBe(35);
  });

  it('matches capabilities deterministically', () => {
    const matcher = new CapabilityMatcher();
    const result = matcher.select(UNIVERSAL_AGENT_CATALOG, { all: ['codeGeneration', 'fileEditing'], preferredAgentIds: ['opencode'] });
    expect(result?.agent.id).toBe('opencode');
    expect(result?.missing).toEqual([]);
  });

  it('keeps authentication inspection secret-free', () => {
    const manager = new AuthenticationManager();
    const result = manager.inspect(UNIVERSAL_AGENT_CATALOG.find((agent) => agent.id === 'opencode')!);
    expect(result.detail).not.toContain(process.env.OPENCODE_API_KEY ?? '__missing__');
    expect(result.checkedEnvironmentVariables).toEqual([]);
  });

  it('can inspect every catalog definition without executing it', async () => {
    const registry = new UniversalAgentRegistry();
    const detections = await registry.detectAll({ timeoutMs: 100 });
    expect(detections).toHaveLength(35);
    expect(detections.every((item) => item.id && typeof item.installed === 'boolean')).toBe(true);
  });
});
