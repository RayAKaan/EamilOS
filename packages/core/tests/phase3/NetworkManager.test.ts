import { describe, it, expect, beforeEach } from 'vitest';
import { NetworkManager } from '../../src/distributed/NetworkManager.js';
import type { NodeIdentity, NetworkConfig } from '../../src/distributed/types.js';

describe('NetworkManager', () => {
  let identity: NodeIdentity;
  let config: NetworkConfig;
  let manager: NetworkManager;

  beforeEach(() => {
    identity = {
      id: 'test-node',
      name: 'test-node',
      role: 'controller',
      version: '1.0.0',
      startedAt: Date.now(),
    };

    config = {
      security: {
        sharedKey: 'test-secret-key',
        sessionTimeoutMs: 3600000,
        requireSignedMessages: true,
        maxConnectionAttempts: 5,
        banDurationMs: 300000,
      },
      heartbeat: {
        intervalMs: 10000,
        timeoutMs: 30000,
        missedBeforeDisconnect: 3,
      },
      execution: {
        taskTimeoutMs: 300000,
        retryOnNodeFailure: true,
        maxTaskRetries: 2,
        preferLocalExecution: true,
        mode: 'hybrid' as const,
      },
    };

    manager = new NetworkManager('controller', identity, config);
  });

  describe('constructor', () => {
    it('should initialize with provided identity', () => {
      expect(manager.identity_).toEqual(identity);
    });
  });

  describe('startController', () => {
    it('should start controller mode', async () => {
      const events: unknown[] = [];
      manager.on('network:controller-started', (data) => events.push(data));

      await manager.startController(7891);

      expect(events.length).toBe(1);
      expect((events[0] as { port: number }).port).toBe(7891);
    });

    it('should use default port when not specified', async () => {
      const events: unknown[] = [];
      manager.on('network:controller-started', (data) => events.push(data));

      await manager.startController();

      expect(events.length).toBe(1);
    });

    it('should reject starting controller on worker node', async () => {
      const workerManager = new NetworkManager('worker', identity, config);

      await expect(workerManager.startController()).rejects.toThrow('Cannot start controller on a worker node');
    });
  });

  describe('startWorker', () => {
    it('should start worker mode', async () => {
      const events: unknown[] = [];
      const workerManager = new NetworkManager('worker', identity, config);
      workerManager.on('network:worker-started', (data) => events.push(data));

      await workerManager.startWorker(7892);

      expect(events.length).toBe(1);
      expect((events[0] as { port: number }).port).toBe(7892);
    });

    it('should reject starting worker on controller node', async () => {
      await expect(manager.startWorker()).rejects.toThrow('Cannot start worker on a controller node');
    });
  });

  describe('connectToWorker', () => {
    it('should connect to worker and return node status', async () => {
      const events: unknown[] = [];
      manager.on('network:worker-connected', (data) => events.push(data));

      const nodeStatus = await manager.connectToWorker('ws://localhost:7890', 'test-worker');

      expect(nodeStatus).toBeDefined();
      expect(nodeStatus.identity).toBeDefined();
      expect(nodeStatus.capabilities).toBeDefined();
      expect(nodeStatus.connectionState).toBe('ready');
      expect(events.length).toBe(1);
    });

    it('should track connected workers', async () => {
      await manager.connectToWorker('ws://localhost:7890', 'worker1');
      await manager.connectToWorker('ws://localhost:7891', 'worker2');

      const workers = manager.getConnectedWorkers();
      expect(workers.length).toBe(2);
    });
  });

  describe('hasWorkers', () => {
    it('should return false when no workers connected', () => {
      expect(manager.hasWorkers()).toBe(false);
    });

    it('should return true when workers connected', async () => {
      await manager.connectToWorker('ws://localhost:7890', 'worker1');
      expect(manager.hasWorkers()).toBe(true);
    });
  });

  describe('getNetworkCapacity', () => {
    it('should return empty capacity when no workers', () => {
      const capacity = manager.getNetworkCapacity();

      expect(capacity.connectedNodes).toBe(0);
      expect(capacity.readyNodes).toBe(0);
      expect(capacity.totalModels).toHaveLength(0);
      expect(capacity.totalGPUs).toBe(0);
      expect(capacity.totalTaskSlots).toBe(0);
    });

    it('should calculate capacity from connected workers', async () => {
      await manager.connectToWorker('ws://localhost:7890', 'worker1');

      const capacity = manager.getNetworkCapacity();

      expect(capacity.connectedNodes).toBe(1);
      expect(capacity.totalModels.length).toBeGreaterThan(0);
    });
  });

  describe('shared key resolution', () => {
    it('should throw when env key not set', () => {
      const badConfig: NetworkConfig = {
        security: {
          sharedKey: 'env:NONEXISTENT_VAR_12345',
          sessionTimeoutMs: 3600000,
          requireSignedMessages: true,
          maxConnectionAttempts: 5,
          banDurationMs: 300000,
        },
        heartbeat: { intervalMs: 10000, timeoutMs: 30000, missedBeforeDisconnect: 3 },
        execution: {
          taskTimeoutMs: 300000,
          retryOnNodeFailure: true,
          maxTaskRetries: 2,
          preferLocalExecution: true,
          mode: 'hybrid' as const,
        },
      };

      expect(() => new NetworkManager('controller', identity, badConfig)).toThrow('Network key missing');
    });
  });

  describe('shutdown', () => {
    it('should clear all workers on shutdown', async () => {
      await manager.connectToWorker('ws://localhost:7890', 'worker1');
      await manager.connectToWorker('ws://localhost:7891', 'worker2');

      expect(manager.hasWorkers()).toBe(true);

      await manager.shutdown();

      expect(manager.hasWorkers()).toBe(false);
    });
  });
});
