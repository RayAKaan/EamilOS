import { describe, expect, it } from 'vitest';
import { EamilosA2AServer } from './EamilosA2AServer.js';
import { EamilosA2AClient } from './EamilosA2AClient.js';
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
});
