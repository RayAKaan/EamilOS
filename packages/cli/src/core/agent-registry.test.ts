import { describe, expect, it } from 'vitest';
import { initAgentRegistry } from './agent-registry.js';

describe('legacy registry compatibility', () => {
  it('exposes the universal fleet through the compatibility registry', () => {
    const registry = initAgentRegistry();
    expect(registry.getAllAgents()).toHaveLength(35);
    expect(registry.getAgent('opencode')).toBeDefined();
    expect(registry.getAgent('amp')).toBeDefined();
  });
});
