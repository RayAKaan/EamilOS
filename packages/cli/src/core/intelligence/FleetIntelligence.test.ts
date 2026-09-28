import { describe, expect, it, vi } from 'vitest';
import { GitHubWorkspaceManager } from '../git/GitHubWorkspaceManager.js';
import { StaticFleetIntelligenceProvider } from './FleetIntelligence.js';

describe('Phase 8 distributed intelligence', () => {
  it('builds a fleet-aware intelligence context', () => {
    const provider = new StaticFleetIntelligenceProvider(() => [
      { nodeId: 'a', state: 'online', capabilities: ['gpu', 'cuda'], activeTasks: 1, maxConcurrentTasks: 2, lastSeenAt: Date.now() },
      { nodeId: 'b', state: 'offline', capabilities: ['node'], activeTasks: 0, maxConcurrentTasks: 2, lastSeenAt: Date.now() },
    ]);
    const context = provider.snapshot();
    expect(context.healthyNodeCount).toBe(1);
    expect(context.capableNodeCount).toBe(1);
    expect(context.nodes[0].capabilities).toContain('cuda');
  });

  it('allocates a GitHub-compatible task branch without executing Git', () => {
    const git = {
      branchLocal: vi.fn().mockResolvedValue({ all: [], current: 'main' }),
      checkoutBranch: vi.fn(),
      checkout: vi.fn(),
      status: vi.fn(),
      add: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
    };
    const manager = new GitHubWorkspaceManager({ cwd: '/repo', git: git as never });
    expect(manager.currentBranch()).resolves.toBe('main');
  });
});
