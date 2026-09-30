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

  it('detects incrementally and reuses the in-flight promise', async () => {
    const incremental = new AgentRegistry();
    const seen: string[] = [];
    let detectorCalls = 0;
    incremental.registerDetector({
      id: 'test-agent',
      name: 'Test Agent',
      kind: 'cli',
      provider: 'test',
      supportedModes: ['communication'],
      priority: 99,
      capabilities: { codeGeneration: false, fileEditing: false, commandExecution: false, webResearch: false, longContext: false, local: true, cloud: false, multimodal: false },
      detect: async () => {
        detectorCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 5));
        return { available: true, version: 'test' };
      },
    });
    const p1 = incremental.detect({ onAgent: (agent) => seen.push(agent.id) });
    const p2 = incremental.detect();
    await Promise.all([p1, p2]);
    expect(seen).toEqual(['test-agent']);
    expect(detectorCalls).toBe(1);
    expect(incremental.getAvailableAgents('communication').map(a => a.id)).toEqual(['test-agent']);
  });

  it('suggestStrategy returns fallback for empty registry', () => {
    const suggestion = registry.suggestStrategy('build a web app');
    expect(suggestion).toBe('fallback');
  });
});
