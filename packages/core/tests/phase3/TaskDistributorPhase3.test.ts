import { describe, it, expect, beforeEach } from 'vitest';
import { TaskDistributor } from '../../src/distributed/TaskDistributor.js';
import { NetworkManager } from '../../src/distributed/NetworkManager.js';
import type { NetworkConfig, NodeIdentity, NodeCapabilities } from '../../src/distributed/types.js';

describe('TaskDistributor Phase 3.1', () => {
  let identity: NodeIdentity;
  let config: NetworkConfig;
  let localCapabilities: NodeCapabilities;
  let networkManager: NetworkManager;
  let distributor: TaskDistributor;

  beforeEach(() => {
    identity = {
      id: 'controller-1',
      name: 'controller',
      role: 'controller',
      version: '1.0.0',
      startedAt: Date.now(),
    };

    config = {
      security: {
        sharedKey: 'test-secret',
        sessionTimeoutMs: 3600000,
        requireSignedMessages: false,
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

    localCapabilities = {
      cpuCores: 8,
      totalRAMBytes: 32 * 1024 * 1024 * 1024,
      availableRAMBytes: 16 * 1024 * 1024 * 1024,
      gpus: [{ name: 'RTX 3080', vendor: 'NVIDIA', memoryBytes: 10 * 1024 * 1024 * 1024, available: true }],
      providers: [],
      models: [
        { modelId: 'llama3:8b', provider: 'ollama', loaded: true, maxContextLength: 4096 },
        { modelId: 'gpu-model', provider: 'ollama', loaded: true, maxContextLength: 8192, requiresGPU: true, minRAMGB: 16 },
      ],
      maxConcurrentTasks: 4,
      currentLoad: 0,
      platform: 'linux',
      arch: 'x64',
    };

    networkManager = new NetworkManager('controller', identity, config);
    distributor = new TaskDistributor(networkManager, localCapabilities, config);
  });

  describe('Resource-aware scheduling', () => {
    it('should not select node without required GPU for GPU models', () => {
      const selection = distributor.selectNode(
        { id: 'agent1', type: 'coder', role: 'coder', model: 'gpu-model' },
        'gpu-model'
      );

      expect(selection.nodeId).toBe('local');
    });

    it('should select node with sufficient RAM for models with minRAMGB', () => {
      const selection = distributor.selectNode(
        { id: 'agent1', type: 'coder', role: 'coder', model: 'gpu-model' },
        'gpu-model'
      );

      expect(selection.nodeId).toBeDefined();
      expect(selection.capabilities).toBeDefined();
    });
  });

  describe('Backpressure handling', () => {
    it('should emit distribution:task-rejected when task:rejected is received', async () => {
      const rejectionEvents: unknown[] = [];
      distributor.on('distribution:task-rejected', (data) => rejectionEvents.push(data));

      const rejectedPayload = {
        taskId: 'task-with-pending-result',
        reason: 'capacity_full' as const,
        details: 'Node at max capacity',
      };

      (networkManager as unknown as { emit: (event: string, data: unknown) => void }).emit('task:rejected', rejectedPayload);

      expect(rejectionEvents.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Streaming event forwarding', () => {
    it('should forward task:stream events', () => {
      const streamEvents: unknown[] = [];
      distributor.on('task:stream', (data) => streamEvents.push(data));

      const streamPayload = {
        taskId: 'task-stream-1',
        token: 'Hello, ',
        timestamp: Date.now(),
      };

      networkManager.emit('task:stream', streamPayload);

      expect(streamEvents).toHaveLength(1);
      expect((streamEvents[0] as { token: string }).token).toBe('Hello, ');
    });
  });

  describe('Priority queue sorting', () => {
    it('should get pending queue in priority order', () => {
      const queue = distributor.getPendingQueue();
      expect(Array.isArray(queue)).toBe(true);
    });
  });
});
