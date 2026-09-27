import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CoordinationEngine, CoordinationStore } from '../coordination/index.js';
import { MissionEngine, MissionStore } from '../mission/index.js';
import type { HarnessAdapter } from './HarnessAdapter.js';
import { ExecutionStore } from './ExecutionStore.js';
import { HarnessRegistry } from './HarnessRegistry.js';
import { HarnessScheduler } from './HarnessScheduler.js';
import type {
  HarnessAvailability,
  HarnessDescriptor,
  HarnessExecutionRequest,
  HarnessExecutionResult,
  ExecutionCheckpoint,
  HarnessHealth,
} from './types.js';

function adapter(
  id: string,
  resultFactory: (request: HarnessExecutionRequest) => HarnessExecutionResult,
): HarnessAdapter {
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
      checkpointResume: false,
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

  return {
    descriptor,
    detect: async () => availability,
    start: async (request) => resultFactory(request),
    cancel: async () => undefined,
    checkpoint: async (executionId): Promise<ExecutionCheckpoint> => ({
      id: `checkpoint_${executionId}`,
      missionId: requestMission(executionId),
      taskId: 'task_1',
      executionId,
      harnessId: id,
      nodeId: 'local',
      createdAt: new Date().toISOString(),
      progress: { completedSteps: [], remainingSteps: [] },
      output: '',
      artifacts: [],
      metadata: {},
    }),
    resume: async (checkpoint, request) => resultFactory({
      ...request,
      context: { ...request.context, checkpoint },
    }),
    health: async (): Promise<HarnessHealth> => ({
      harnessId: id,
      status: 'AVAILABLE',
      lastCheckedAt: new Date().toISOString(),
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
    }),
  };
}

function requestMission(_executionId: string): string {
  return 'mission_1';
}

function completed(request: HarnessExecutionRequest): HarnessExecutionResult {
  return {
    executionId: request.executionId,
    missionId: request.missionId,
    taskId: request.taskId,
    harnessId: request.harnessId,
    nodeId: request.nodeId,
    status: 'COMPLETED',
    output: 'done',
    artifacts: [{ path: 'output.txt', type: 'text' }],
    fileChanges: [{ path: 'output.txt', action: 'create' }],
    evidence: [],
    metrics: {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 1,
    },
  };
}

function quota(request: HarnessExecutionRequest): HarnessExecutionResult {
  return {
    ...completed(request),
    status: 'QUOTA_EXHAUSTED',
    output: 'partial',
    error: {
      type: 'QUOTA_EXHAUSTED',
      message: 'quota exhausted',
      retryable: false,
      fallbackEligible: true,
    },
  };
}

async function setup() {
  const base = mkdtempSync(join(tmpdir(), 'eamilos-phase2-'));
  const missions = new MissionEngine(new MissionStore(join(base, 'missions')));
  const coordination = new CoordinationEngine(
    missions,
    new CoordinationStore(join(base, 'coordination')),
  );
  const registry = new HarnessRegistry(false);
  const executions = new ExecutionStore(join(base, 'executions'));

  const mission = missions.createMission({
    id: 'mission_1',
    goal: 'test execution',
    workingDir: base,
  });
  missions.start(mission.id);
  missions.addTask(mission.id, {
    id: 'task_1',
    title: 'Test task',
    description: 'Execute the test task',
    requiredCapabilities: ['codeGeneration'],
    maxAttempts: 3,
    idempotencyKey: 'task_1',
  });

  return { missions, coordination, registry, executions };
}

describe('HarnessScheduler', () => {
  it('executes a task and leaves authoritative completion to validation', async () => {
    const { missions, coordination, registry, executions } = await setup();
    registry.register(adapter('alpha', completed));

    const scheduler = new HarnessScheduler(
      missions,
      coordination,
      registry,
      executions,
    );

    const result = await scheduler.execute('mission_1', 'task_1', {
      writeSet: [{ id: 'output.txt', kind: 'file', mode: 'write' }],
    });

    expect(result.validationRequired).toBe(true);
    expect(result.completed).toBe(false);
    expect(missions.snapshot('mission_1').tasks[0].state).toBe('VALIDATING');
    expect(executions.getLatestExecutionForTask('mission_1', 'task_1')?.state).toBe('VALIDATING');
    expect(coordination.snapshot('mission_1').reservations.every((item) => item.status === 'RELEASED')).toBe(true);
  });

  it('falls back after quota exhaustion while preserving a checkpoint', async () => {
    const { missions, coordination, registry, executions } = await setup();
    registry.register(adapter('quota-harness', quota));
    registry.register(adapter('fallback-harness', completed));

    const scheduler = new HarnessScheduler(
      missions,
      coordination,
      registry,
      executions,
    );

    const result = await scheduler.execute('mission_1', 'task_1', {
      preferredHarnessId: 'quota-harness',
    });

    expect(result.validationRequired).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.executions[0].failure).toBe('QUOTA_EXHAUSTED');
    expect(executions.getLatestCheckpoint('mission_1', 'task_1')).not.toBeNull();
    expect(result.finalResult.harnessId).toBe('fallback-harness');
  });
});
