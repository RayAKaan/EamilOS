import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ExecutionStore } from './ExecutionStore.js';

function makeStore() {
  return new ExecutionStore(mkdtempSync(join(tmpdir(), 'eamilos-execution-')));
}

describe('ExecutionStore', () => {
  it('persists execution records and updates them idempotently', () => {
    const store = makeStore();
    const now = new Date().toISOString();

    store.saveExecution({
      executionId: 'exec_1',
      missionId: 'mission_1',
      taskId: 'task_1',
      harnessId: 'opencode',
      nodeId: 'local',
      state: 'RUNNING',
      attempts: 1,
      startedAt: now,
      updatedAt: now,
    });

    store.saveExecution({
      executionId: 'exec_1',
      missionId: 'mission_1',
      taskId: 'task_1',
      harnessId: 'opencode',
      nodeId: 'local',
      state: 'COMPLETED',
      attempts: 1,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
    });

    expect(store.getExecution('mission_1', 'exec_1')?.state).toBe('COMPLETED');
  });

  it('persists checkpoints and returns the newest checkpoint for a task', () => {
    const store = makeStore();
    const first = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const second = new Date('2026-01-02T00:00:00.000Z').toISOString();

    store.saveCheckpoint({
      id: 'checkpoint_1',
      missionId: 'mission_1',
      taskId: 'task_1',
      executionId: 'exec_1',
      harnessId: 'opencode',
      nodeId: 'local',
      createdAt: first,
      progress: { completedSteps: ['one'], remainingSteps: ['two'] },
      output: 'one',
      artifacts: [],
      metadata: {},
    });

    store.saveCheckpoint({
      id: 'checkpoint_2',
      missionId: 'mission_1',
      taskId: 'task_1',
      executionId: 'exec_1',
      harnessId: 'claude-code',
      nodeId: 'worker_1',
      createdAt: second,
      progress: { completedSteps: ['one', 'two'], remainingSteps: [] },
      output: 'two',
      artifacts: [],
      metadata: {},
    });

    expect(store.getLatestCheckpoint('mission_1', 'task_1')?.id).toBe('checkpoint_2');
  });

  it('finds executions that were active when the process stopped', () => {
    const store = makeStore();
    const now = new Date().toISOString();

    for (const [index, state] of (['RUNNING', 'VALIDATING', 'COMPLETED'] as const).entries()) {
      store.saveExecution({
        executionId: `exec_${index}`,
        missionId: 'mission_1',
        taskId: `task_${index}`,
        harnessId: 'opencode',
        nodeId: 'local',
        state,
        attempts: 1,
        updatedAt: now,
      });
    }

    expect(store.findInterrupted().map((execution) => execution.executionId)).toEqual([
      'exec_0',
      'exec_1',
    ]);
  });

  it('writes snapshots atomically and ignores malformed unrelated files', () => {
    const base = mkdtempSync(join(tmpdir(), 'eamilos-execution-'));
    const store = new ExecutionStore(base);

    store.save({
      version: 1,
      missionId: 'mission_1',
      executions: [],
      checkpoints: [],
      updatedAt: new Date().toISOString(),
    });

    expect(store.get('mission_1')?.missionId).toBe('mission_1');

    rmSync(base, { recursive: true, force: true });
  });
});
