import { describe, expect, it } from 'vitest';
import { UNIVERSAL_AGENT_CATALOG, getUniversalAgentDefinition } from './catalog.js';

describe('universal agent catalog', () => {
  it('contains the approved 35-agent fleet', () => {
    expect(UNIVERSAL_AGENT_CATALOG).toHaveLength(35);
    expect(new Set(UNIVERSAL_AGENT_CATALOG.map((agent) => agent.id)).size).toBe(35);
  });

  it('contains the original seven agents', () => {
    for (const id of ['opencode', 'claude-code', 'gemini-cli', 'aider', 'goose', 'codex-cli', 'deepseek-harness']) {
      expect(getUniversalAgentDefinition(id)).toBeDefined();
    }
  });

  it('has installation, protocol and capability metadata for every agent', () => {
    for (const agent of UNIVERSAL_AGENT_CATALOG) {
      expect(agent.installation.strategy).toBeTruthy();
      expect(agent.protocols.length).toBeGreaterThan(0);
      expect(Object.keys(agent.capabilities).length).toBeGreaterThan(10);
      expect(agent.executableCandidates.length).toBeGreaterThan(0);
    }
  });
});
