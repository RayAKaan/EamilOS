import { describe, expect, it, vi } from 'vitest';
import { ContextCompiler } from './ContextCompiler.js';
import { ContextHasher } from './ContextHasher.js';
import { ContextSanitizer } from './ContextSanitizer.js';
import { IntelligenceRuntime } from './IntelligenceRuntime.js';
import { IntelligenceRouter } from './IntelligenceRouter.js';
import { IntelligenceProviderRegistry } from './ProviderRegistry.js';
import type { IntelligenceProvider } from './IntelligenceRuntimeTypes.js';

function provider(id: string, ready = true): IntelligenceProvider {
  return {
    id,
    capabilities: () => ({
      strategicDecision: true,
      taskDecision: true,
      recoveryDecision: true,
      planning: false,
      validationAssessment: true,
      agentSelection: true,
      parallelization: true,
      local: true,
      remote: false,
      streaming: false,
    }),
    initialize: vi.fn(async () => {}),
    health: vi.fn(async () => ({
      providerId: id,
      status: ready ? 'READY' : 'UNAVAILABLE',
      checkedAt: new Date().toISOString(),
      capabilities: {
        strategicDecision: true, taskDecision: true, recoveryDecision: true,
        planning: false, validationAssessment: true, agentSelection: true,
        parallelization: true, local: true, remote: false, streaming: false,
      },
    })),
    evaluate: vi.fn(async request => ({
      requestId: request.requestId,
      providerId: id,
      status: 'SUCCESS' as const,
      result: { ok: true },
      latencyMs: 1,
      contextVersion: request.contextVersion,
      contextHash: request.contextHash,
    })),
    shutdown: vi.fn(async () => {}),
  };
}

describe('Phase 2A intelligence foundation', () => {
  it('produces stable canonical hashes', () => {
    expect(ContextHasher.hash({ b: 2, a: 1 })).toBe(ContextHasher.hash({ a: 1, b: 2 }));
  });

  it('redacts secrets and bounds context', () => {
    const sanitizer = new ContextSanitizer({ maxStringLength: 8 });
    const result = sanitizer.sanitize({ apiKey: 'secret', text: '1234567890' });
    expect(result).toEqual({ apiKey: '[REDACTED]', text: '12345678\n[TRUNCATED]' });
  });

  it('compiles versioned contexts with hashes', () => {
    const compiler = new ContextCompiler();
    const context = {
      schemaVersion: '1.0' as const,
      mission: { id: 'm', goal: 'g', status: 'active', constraints: {}, completionCriteria: [], requirements: {}, graphVersion: 7 },
      project: { workspace: { workingDir: '/tmp' }, relevantFiles: [] },
      agents: [], taskGraph: { version: 7, tasks: [], dependencies: [], readyTasks: [], runningTasks: [], blockedTasks: [], completedTasks: [], failedTasks: [] },
      coordination: { conflicts: [], activeReservations: [], activeLeases: [], localPlans: [] },
      executions: [], failures: [], checkpoints: [], evidence: [], artifacts: { files: [], diffs: [], evidence: [] }, decisions: [],
      progress: { totalTasks: 0, completedTasks: 0, runningTasks: 0, blockedTasks: 0, failedTasks: 0, readyTasks: 0, completionRatio: 0, progressSinceLastDecision: false },
      timestamp: new Date().toISOString(),
    };
    const compiled = compiler.decision(context);
    expect(compiled.version).toBe(7);
    expect(compiled.hash).toHaveLength(64);
  });

  it('routes only to healthy capable providers', async () => {
    const registry = new IntelligenceProviderRegistry();
    registry.register(provider('offline', false));
    registry.register(provider('online', true));
    const router = new IntelligenceRouter(registry);
    const route = await router.route({
      requestId: 'r',
      missionId: 'm',
      type: 'STRATEGIC_DECISION',
      priority: 'NORMAL',
      contextVersion: 1,
      contextHash: 'hash',
      context: {},
    });
    expect(route.selectedProviderId).toBe('online');
    expect(route.providerIds).toEqual(['online']);
  });

  it('returns structured unavailability instead of throwing', async () => {
    const registry = new IntelligenceProviderRegistry();
    registry.register(provider('offline', false));
    const runtime = new IntelligenceRuntime(registry);
    const result = await runtime.request({
      requestId: 'r',
      missionId: 'm',
      type: 'STRATEGIC_DECISION',
      priority: 'NORMAL',
      contextVersion: 1,
      contextHash: 'hash',
      context: {},
    });
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.error?.code).toBe('NO_PROVIDER');
  });
});
