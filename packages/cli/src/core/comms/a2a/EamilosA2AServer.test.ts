import { describe, expect, it } from 'vitest';
import { EamilosA2AServer } from './EamilosA2AServer.js';
import { EamilosA2AClient } from './EamilosA2AClient.js';
import { EamilosSqliteResourceLeaseManager } from './EamilosResourceLeaseManager.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TaskRequest } from './EamilosA2AProtocol.js';

const request: TaskRequest = {
  kind: 'task.request', protocolVersion: 1, missionId: 'm1', taskId: 't1', executionId: 'e1',
  requestId: 'r1', idempotencyKey: 'm1:t1:e1', graphVersion: 1, contextVersion: 1,
  contextHash: 'a'.repeat(64), capabilities: ['code.execution'], resources: { readSet: [], writeSet: [] },
  constraints: {}, timeoutMs: 10_000, acceptanceCriteria: [], input: {},
};

describe('EamilOS A2A server', () => {
  it('publishes an Agent Card and idempotently accepts tasks', async () => {
    const server = new EamilosA2AServer({
      workerId: 'worker-1',
      card: {
        kind: 'agent.card', protocolVersion: 1, workerId: 'worker-1', agentId: 'agent-1',
        harnessId: 'harness-1', name: 'worker', description: 'test worker',
        endpoint: 'http://127.0.0.1:1', capabilities: ['code.execution'], maxConcurrency: 2,
        streaming: true, checkpointResume: true, authentication: [], metadata: {},
        advertisedAt: new Date().toISOString(),
      },
      currentGraphVersion: () => 1,
      currentContextHash: () => 'a'.repeat(64),
      validateRequest: (value) => {
        if (!value.capabilities.includes('code.execution')) throw new Error('unsupported capability');
      },
    });
    const address = await server.start();
    const endpoint = `http://${address.host}:${address.port}`;
    const client = new EamilosA2AClient();
    try {
      const card = await client.discover(endpoint);
      expect(card.workerId).toBe('worker-1');
      const first = await client.send(endpoint, request);
      expect(first.kind).toBe('task.accepted');
      const second = await client.send(endpoint, request);
      expect(second.kind).toBe('task.accepted');
    } finally {
      await server.stop();
    }
  });
  it('enforces resource conflicts at admission and releases terminal leases', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'eamilos-server-lock-'));
    const filename = join(directory, 'leases.sqlite');
    const leases = new EamilosSqliteResourceLeaseManager({ filename });
    const server = new EamilosA2AServer({
      workerId: 'worker-1',
      resourceLeaseManager: leases,
      resourceLeaseTtlMs: 30_000,
      card: {
        kind: 'agent.card', protocolVersion: 1, workerId: 'worker-1', agentId: 'agent-1',
        harnessId: 'harness-1', name: 'worker', description: 'test worker',
        endpoint: 'http://127.0.0.1:1', capabilities: ['code.execution'], maxConcurrency: 2,
        streaming: true, checkpointResume: true, authentication: [], metadata: {},
        advertisedAt: new Date().toISOString(),
      },
    });
    const firstRequest = {
      ...request,
      executionId: 'lock-e1',
      idempotencyKey: 'm1:t1:lock-e1',
      resources: { readSet: [], writeSet: ['repo/main'] },
    };
    const secondRequest = {
      ...request,
      executionId: 'lock-e2',
      idempotencyKey: 'm1:t1:lock-e2',
      resources: { readSet: [], writeSet: ['repo/main'] },
    };

    const address = await server.start();
    const endpoint = `http://${address.host}:${address.port}`;
    try {
      const first = await fetch(`${endpoint}/eamilos/a2a/tasks`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(firstRequest),
      });
      const accepted = await first.json() as { kind: string; leaseId?: string; fencingToken?: number };
      expect(first.status).toBe(202);
      expect(accepted.kind).toBe('task.accepted');
      expect(accepted.leaseId).toBeTruthy();
      expect(accepted.fencingToken).toBe(1);

      const second = await fetch(`${endpoint}/eamilos/a2a/tasks`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(secondRequest),
      });
      const rejected = await second.json() as { kind: string; reason: string };
      expect(second.status).toBe(409);
      expect(rejected.kind).toBe('task.rejected');
      expect(rejected.reason).toBe('resource_conflict');

      const completed = await fetch(`${endpoint}/eamilos/a2a/tasks/${firstRequest.executionId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'task.completed', protocolVersion: 1, missionId: firstRequest.missionId,
          taskId: firstRequest.taskId, executionId: firstRequest.executionId,
          requestId: firstRequest.requestId, idempotencyKey: firstRequest.idempotencyKey,
          graphVersion: firstRequest.graphVersion, timestamp: new Date().toISOString(),
          workerId: 'worker-1', evidenceIds: [], artifactIds: [], output: {},
        }),
      });
      expect(completed.status).toBe(200);
      expect(leases.getByExecution(firstRequest.executionId)).toBeUndefined();

      const third = await fetch(`${endpoint}/eamilos/a2a/tasks`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          ...secondRequest,
          requestId: 'r3',
        }),
      });
      expect(third.status).toBe(202);
    } finally {
      await server.stop();
      leases.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
