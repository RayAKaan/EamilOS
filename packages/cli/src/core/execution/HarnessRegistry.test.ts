import { describe, expect, it } from 'vitest';
import { HarnessRegistry } from './HarnessRegistry.js';
import type { HarnessAdapter } from './HarnessAdapter.js';
import type {
  HarnessAvailability,
  HarnessDescriptor,
  HarnessExecutionRequest,
  HarnessExecutionResult,
  ExecutionCheckpoint,
  HarnessHealth,
} from './types.js';

function fakeAdapter(id = 'fake'): HarnessAdapter {
  const descriptor: HarnessDescriptor = {
    id,
    name: id,
    kind: 'plugin',
    provider: 'test',
    args: [],
    capabilities: {
      codeGeneration: true,
      fileEditing: true,
      commandExecution: true,
      webResearch: false,
      communication: true,
      execution: true,
      local: true,
      remote: false,
      streaming: true,
      cancellation: true,
      checkpointResume: true,
      workspaceIsolation: true,
      multimodal: false,
      longContext: true,
    },
    supportedModes: ['execution'],
    status: 'DISCOVERED',
    availability: {
      installed: false,
      authenticated: false,
      executable: false,
      checkedAt: new Date().toISOString(),
    },
  };

  const availability: HarnessAvailability = {
    installed: true,
    authenticated: true,
    executable: true,
    checkedAt: new Date().toISOString(),
  };

  const health: HarnessHealth = {
    harnessId: id,
    status: 'AVAILABLE',
    lastCheckedAt: availability.checkedAt,
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
  };

  return {
    descriptor,
    detect: async () => availability,
    start: async (_request: HarnessExecutionRequest): Promise<HarnessExecutionResult> => ({
      executionId: 'execution_1',
      missionId: 'mission_1',
      taskId: 'task_1',
      harnessId: id,
      nodeId: 'local',
      status: 'COMPLETED',
      artifacts: [],
      fileChanges: [],
      evidence: [],
      metrics: { startedAt: new Date().toISOString() },
    }),
    cancel: async () => undefined,
    checkpoint: async (_executionId: string): Promise<ExecutionCheckpoint> => ({
      id: 'checkpoint_1',
      missionId: 'mission_1',
      taskId: 'task_1',
      executionId: 'execution_1',
      harnessId: id,
      nodeId: 'local',
      createdAt: new Date().toISOString(),
      progress: { completedSteps: [], remainingSteps: [] },
    }),
    resume: async () => {
      throw new Error('not used');
    },
    health: async () => health,
  };
}

describe('HarnessRegistry', () => {
  it('registers and refreshes provider availability', async () => {
    const registry = new HarnessRegistry(false);
    registry.register(fakeAdapter());

    expect(registry.descriptor('fake')?.status).toBe('DISCOVERED');

    await registry.refresh();

    expect(registry.descriptor('fake')?.status).toBe('AVAILABLE');
    expect(registry.available().map((item) => item.id)).toEqual(['fake']);
  });

  it('marks failed harnesses unavailable to scheduling', async () => {
    const registry = new HarnessRegistry(false);
    registry.register(fakeAdapter());
    await registry.refresh();

    registry.markFailure('fake', 'QUOTA_EXHAUSTED', 'QUOTA_EXHAUSTED');
    expect(registry.available()).toEqual([]);
    expect(registry.descriptor('fake')?.status).toBe('QUOTA_EXHAUSTED');
  });

  it('restores a harness after a successful execution', async () => {
    const registry = new HarnessRegistry(false);
    registry.register(fakeAdapter());
    await registry.refresh();

    registry.markFailure('fake', 'COOLDOWN', 'TIMEOUT');
    expect(registry.available()).toEqual([]);

    registry.markSuccess('fake');
    expect(registry.available().map((item) => item.id)).toEqual(['fake']);
  });
});
