import { describe, expect, it } from 'vitest';
import { EamilosA2AServer } from './EamilosA2AServer.js';
import { EamilosA2AClient } from './EamilosA2AClient.js';
import { EamilosInMemoryFleetRegistry } from './EamilosFleetRegistry.js';

describe('EamilOS A2A fleet integration', () => {
  it('registers the worker and advances fleet heartbeat state', async () => {
    const registry = new EamilosInMemoryFleetRegistry();
    const server = new EamilosA2AServer({
      workerId: 'fleet-worker-1',
      fleetRegistry: registry,
      activeExecutions: () => 1,
      capacity: () => 3,
      card: {
        kind: 'agent.card', protocolVersion: 1, workerId: 'fleet-worker-1', agentId: 'agent-1',
        harnessId: 'harness-1', name: 'fleet worker', description: 'test',
        endpoint: 'http://127.0.0.1:1', capabilities: ['code.execution'], maxConcurrency: 4,
        streaming: true, checkpointResume: true, authentication: [], metadata: {}, advertisedAt: new Date().toISOString(),
      },
    });
    const address = await server.start();
    const endpoint = `http://${address.host}:${address.port}`;
    try {
      expect(registry.get('fleet-worker-1')?.status).toBe('online');
      const heartbeat = await new EamilosA2AClient().heartbeat(endpoint);
      expect(heartbeat.kind).toBe('heartbeat');
      const worker = registry.get('fleet-worker-1');
      expect(worker?.heartbeatSequence).toBe(1);
      expect(worker?.activeExecutions).toBe(1);
      expect(worker?.capacity).toBe(3);
    } finally {
      await server.stop();
      expect(registry.get('fleet-worker-1')?.status).toBe('offline');
    }
  });
});
