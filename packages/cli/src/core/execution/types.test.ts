import { describe, expect, it } from 'vitest';
import {
  ExecutionCheckpointSchema,
  ExecutionRequestSchema,
  HarnessDescriptorSchema,
  HarnessExecutionResultSchema,
} from './types.js';

const resource = {
  id: 'src/index.ts',
  kind: 'file' as const,
  mode: 'write' as const,
};

const baseDescriptor = {
  id: 'opencode',
  name: 'OpenCode',
  kind: 'cli' as const,
  provider: 'opencode',
  args: [],
  capabilities: {
    codeGeneration: true,
    fileEditing: true,
    commandExecution: true,
    webResearch: true,
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
  supportedModes: ['execution' as const],
  status: 'AVAILABLE' as const,
  availability: {
    installed: true,
    authenticated: true,
    executable: true,
    checkedAt: new Date().toISOString(),
  },
};

describe('phase 2 execution contracts', () => {
  it('validates a harness descriptor', () => {
    expect(HarnessDescriptorSchema.parse(baseDescriptor).id).toBe('opencode');
  });

  it('rejects an execution request with invalid resource references', () => {
    expect(() => ExecutionRequestSchema.parse({
      executionId: 'exec_1',
      missionId: 'mission_1',
      taskId: 'task_1',
      harnessId: 'opencode',
      nodeId: 'local',
      workingDir: '/tmp/project',
      prompt: 'Implement the task',
      context: {
        missionGoal: 'Build the project',
        taskObjective: 'Implement the task',
      },
      resources: {
        readSet: [resource],
        writeSet: [{ ...resource, mode: 'invalid' }],
      },
      timeoutMs: 30_000,
    })).toThrow();
  });

  it('validates resumable checkpoints', () => {
    const checkpoint = ExecutionCheckpointSchema.parse({
      id: 'checkpoint_1',
      missionId: 'mission_1',
      taskId: 'task_1',
      executionId: 'exec_1',
      harnessId: 'opencode',
      nodeId: 'local',
      createdAt: new Date().toISOString(),
      progress: {
        completedSteps: ['inspect repository'],
        remainingSteps: ['implement feature'],
      },
      output: 'Repository inspected.',
    });

    expect(checkpoint.progress.remainingSteps).toEqual(['implement feature']);
  });

  it('requires normalized execution identity and metrics', () => {
    const result = HarnessExecutionResultSchema.parse({
      executionId: 'exec_1',
      missionId: 'mission_1',
      taskId: 'task_1',
      harnessId: 'opencode',
      nodeId: 'local',
      status: 'COMPLETED',
      metrics: {
        startedAt: new Date().toISOString(),
      },
    });

    expect(result.status).toBe('COMPLETED');
  });
});
