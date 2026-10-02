import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EamilosA2ASqliteTaskStore } from './EamilosA2ASqliteTaskStore.js';
import type { TaskRequest } from './EamilosA2AProtocol.js';

const request: TaskRequest = {
  kind: 'task.request',
  protocolVersion: 1,
  missionId: 'mission-durable',
  taskId: 'task-durable',
  executionId: 'execution-durable',
  requestId: 'request-durable',
  idempotencyKey: 'mission-durable:task-durable:execution-durable',
  graphVersion: 4,
  contextVersion: 2,
  contextHash: 'b'.repeat(64),
  capabilities: ['code.execution'],
  resources: { readSet: ['repo'], writeSet: ['repo/src'] },
  constraints: {},
  timeoutMs: 30_000,
  acceptanceCriteria: ['persist'],
  input: { value: 42 },
};

function tempDatabase(): { directory: string; filename: string } {
  const directory = mkdtempSync(join(tmpdir(), 'eamilos-a2a-'));
  return { directory, filename: join(directory, 'tasks.sqlite') };
}

describe('EamilOS A2A durable idempotency store', () => {
  it('survives close and reopen without losing execution identity', () => {
    const { directory, filename } = tempDatabase();
    try {
      const first = new EamilosA2ASqliteTaskStore({ filename });
      first.put(request);
      first.append({
        kind: 'task.accepted',
        protocolVersion: 1,
        missionId: request.missionId,
        taskId: request.taskId,
        executionId: request.executionId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        graphVersion: request.graphVersion,
        timestamp: new Date().toISOString(),
        workerId: 'worker-1',
      });
      first.append({
        kind: 'task.completed',
        protocolVersion: 1,
        missionId: request.missionId,
        taskId: request.taskId,
        executionId: request.executionId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        graphVersion: request.graphVersion,
        timestamp: new Date().toISOString(),
        workerId: 'worker-1',
        evidenceIds: ['evidence-1'],
        artifactIds: ['artifact-1'],
        output: { ok: true },
      });
      first.close();

      const second = new EamilosA2ASqliteTaskStore({ filename });
      const restored = second.getByIdempotencyKey(request.idempotencyKey);
      expect(restored?.request).toEqual(request);
      expect(restored?.latest?.kind).toBe('task.completed');
      expect(restored?.history).toHaveLength(2);
      expect(second.put(request).fingerprint).toBe(restored?.fingerprint);
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('persists idempotency conflicts across process lifetimes', () => {
    const { directory, filename } = tempDatabase();
    try {
      const first = new EamilosA2ASqliteTaskStore({ filename });
      first.put(request);
      first.close();

      const second = new EamilosA2ASqliteTaskStore({ filename });
      expect(() => second.put({ ...request, executionId: 'different-execution' }))
        .toThrow('IDEMPOTENCY_KEY_CONFLICT');
      expect(() => second.put({ ...request, input: { value: 99 } }))
        .toThrow('EXECUTION_ID_REUSE_CONFLICT');
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('deduplicates an exact lifecycle message durably', () => {
    const { directory, filename } = tempDatabase();
    try {
      const store = new EamilosA2ASqliteTaskStore({ filename });
      store.put(request);
      const accepted = {
        kind: 'task.accepted' as const,
        protocolVersion: 1 as const,
        missionId: request.missionId,
        taskId: request.taskId,
        executionId: request.executionId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        graphVersion: request.graphVersion,
        timestamp: '2026-10-02T00:00:00.000Z',
        workerId: 'worker-1',
      };
      const first = store.append(accepted);
      const second = store.append(accepted);
      expect(second.history).toHaveLength(1);
      expect(second.latest).toEqual(first.latest);
      store.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rolls back an invalid lifecycle append atomically', () => {
    const { directory, filename } = tempDatabase();
    try {
      const store = new EamilosA2ASqliteTaskStore({ filename });
      store.put(request);
      store.append({
        kind: 'task.accepted',
        protocolVersion: 1,
        missionId: request.missionId,
        taskId: request.taskId,
        executionId: request.executionId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        graphVersion: request.graphVersion,
        timestamp: new Date().toISOString(),
        workerId: 'worker-1',
      });
      store.append({
        kind: 'task.completed',
        protocolVersion: 1,
        missionId: request.missionId,
        taskId: request.taskId,
        executionId: request.executionId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        graphVersion: request.graphVersion,
        timestamp: new Date().toISOString(),
        workerId: 'worker-1',
        evidenceIds: [],
        artifactIds: [],
        output: {},
      });

      expect(() => store.append({
        kind: 'task.progress',
        protocolVersion: 1,
        missionId: request.missionId,
        taskId: request.taskId,
        executionId: request.executionId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        graphVersion: request.graphVersion,
        timestamp: new Date().toISOString(),
        workerId: 'worker-1',
      })).toThrow('INVALID_A2A_TRANSITION');

      const restored = store.get(request.executionId);
      expect(restored?.latest?.kind).toBe('task.completed');
      expect(restored?.history).toHaveLength(2);
      store.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('creates and migrates the database schema on first open', () => {
    const { directory, filename } = tempDatabase();
    try {
      expect(existsSync(filename)).toBe(false);
      const store = new EamilosA2ASqliteTaskStore({ filename });
      expect(existsSync(filename)).toBe(true);
      expect(store.list()).toEqual([]);
      store.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
