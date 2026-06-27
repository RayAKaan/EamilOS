import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRegistry } from '../core/agents/AgentRegistry.js';

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    vi.restoreAllMocks();
    registry = AgentRegistry.create();
  });

  it('registers CLI agent detectors on creation', () => {
    expect(registry.getAvailableAgents()).toEqual([]);
  });

  it('returns empty list before detect()', () => {
    expect(registry.getAvailableAgents()).toHaveLength(0);
  });

  it('getAgentInfoMap returns empty map before detect', () => {
    const info = registry.getAgentInfoMap();
    expect(info).toEqual({});
  });

  it('getBestAgent returns null when none available', () => {
    const best = registry.getBestAgent('execution');
    expect(best).toBeNull();
  });

  it('suggestStrategy returns fallback for empty registry', () => {
    const suggestion = registry.suggestStrategy('build a web app');
    expect(suggestion).toBe('fallback');
  });
});
