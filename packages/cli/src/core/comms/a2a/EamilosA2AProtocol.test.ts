import { describe, expect, it } from 'vitest';
import { A2AEnvelopeSchema, assertTaskRequestFresh, taskRequestFingerprint, type TaskRequest } from './EamilosA2AProtocol.js';
import { EamilosA2ATaskStore } from './EamilosA2ATaskStore.js';

const request: TaskRequest = {
  kind: 'task.request',
  protocolVersion: 1,
  missionId: 'mission-1',
  taskId: 'task-1',
  executionId: 'execution-1',
  requestId: 'request-1',
  idempotencyKey: 'mission-1:task-1:execution-1',
  graphVersion: 7,
  contextVersion: 3,
  contextHash: 'a'.repeat(64),
  capabilities: ['code.execution'],
  resources: { readSet: ['repo'], writeSet: ['repo/src'] },
  constraints: { maxRetries: 2 },
  timeoutMs: 60_000,
  acceptanceCriteria: ['tests pass'],
  input: { endpoint: 'http://127.0.0.1:4000' },
};

describe('EamilOS A2A Phase 3B protocol', () => {
  it('validates correlation and execution fields', () => {
    expect(A2AEnvelopeSchema.parse(request)).toEqual(request);
    expect(taskRequestFingerprint(request)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects stale graph and context', () => {
    expect(() => assertTaskRequestFresh(request, 8)).toThrow('STALE_GRAPH_VERSION');
    expect(() => assertTaskRequestFresh(request, 7, 'b'.repeat(64))).toThrow('STALE_CONTEXT_HASH');
  });

  it('rejects expired deadlines', () => {
    expect(() => assertTaskRequestFresh({ ...request, deadline: new Date(0).toISOString() }, 7)).toThrow('TASK_DEADLINE_EXPIRED');
  });

  it('deduplicates exact task delivery and rejects key reuse', () => {
    const store = new EamilosA2ATaskStore();
    const first = store.put(request);
    expect(store.put(request)).toBe(first);
    expect(() => store.put({ ...request, executionId: 'execution-2' })).toThrow('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('rejects execution-id reuse and invalid lifecycle transitions', () => {
    const store = new EamilosA2ATaskStore();
    store.put(request);
    expect(() => store.put({ ...request, input: { endpoint: 'http://other' } })).toThrow('EXECUTION_ID_REUSE_CONFLICT');
    store.append({
      kind: 'task.accepted', protocolVersion: 1, missionId: request.missionId, taskId: request.taskId,
      executionId: request.executionId, requestId: request.requestId, idempotencyKey: request.idempotencyKey,
      graphVersion: request.graphVersion, timestamp: new Date().toISOString(), workerId: 'worker-1',
    });
    store.append({
      kind: 'task.completed', protocolVersion: 1, missionId: request.missionId, taskId: request.taskId,
      executionId: request.executionId, requestId: request.requestId, idempotencyKey: request.idempotencyKey,
      graphVersion: request.graphVersion, timestamp: new Date().toISOString(), workerId: 'worker-1',
    });
    expect(() => store.append({
      kind: 'task.progress', protocolVersion: 1, missionId: request.missionId, taskId: request.taskId,
      executionId: request.executionId, requestId: request.requestId, idempotencyKey: request.idempotencyKey,
      graphVersion: request.graphVersion, timestamp: new Date().toISOString(), workerId: 'worker-1',
    })).toThrow('INVALID_A2A_TRANSITION');
  });

  it('tracks lifecycle without allowing unknown executions', () => {
    const store = new EamilosA2ATaskStore();
    store.put(request);
    store.append({
      kind: 'task.accepted', protocolVersion: 1, missionId: request.missionId, taskId: request.taskId,
      executionId: request.executionId, requestId: request.requestId, idempotencyKey: request.idempotencyKey,
      graphVersion: request.graphVersion, timestamp: new Date().toISOString(), workerId: 'worker-1',
    });
    expect(store.get(request.executionId)?.latest?.kind).toBe('task.accepted');
    expect(() => store.append({
      kind: 'task.failed', protocolVersion: 1, missionId: request.missionId, taskId: request.taskId,
      executionId: 'missing', requestId: request.requestId, idempotencyKey: request.idempotencyKey,
      graphVersion: request.graphVersion, timestamp: new Date().toISOString(), workerId: 'worker-1',
      error: 'x', retryable: true,
    })).toThrow('Unknown execution');
  });
});


describe('EamilOS A2A lifecycle edge cases', () => {
  it('rejects a second terminal event', () => {
    const store = new EamilosA2ATaskStore();
    store.put(request);
    store.append({
      kind: 'task.accepted', protocolVersion: 1, missionId: request.missionId, taskId: request.taskId,
      executionId: request.executionId, requestId: request.requestId, idempotencyKey: request.idempotencyKey,
      graphVersion: request.graphVersion, timestamp: new Date().toISOString(), workerId: 'worker-1',
    });
    store.append({
      kind: 'task.failed', protocolVersion: 1, missionId: request.missionId, taskId: request.taskId,
      executionId: request.executionId, requestId: request.requestId, idempotencyKey: request.idempotencyKey,
      graphVersion: request.graphVersion, timestamp: new Date().toISOString(), workerId: 'worker-1',
      error: 'failed', retryable: false,
    });
    expect(() => store.append({
      kind: 'task.completed', protocolVersion: 1, missionId: request.missionId, taskId: request.taskId,
      executionId: request.executionId, requestId: request.requestId, idempotencyKey: request.idempotencyKey,
      graphVersion: request.graphVersion, timestamp: new Date().toISOString(), workerId: 'worker-1',
    })).toThrow('INVALID_A2A_TRANSITION');
  });
});
