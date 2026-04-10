import { describe, it, expect, beforeEach } from 'vitest';
import { NetworkManager } from '../../src/distributed/NetworkManager.js';
import type { NetworkConfig, NodeIdentity } from '../../src/distributed/types.js';

describe('NetworkManager Phase 3.2', () => {
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
        adaptive: true,
        minTimeoutMs: 2000,
        maxTimeoutMs: 30000,
      },
      execution: {
        taskTimeoutMs: 300000,
        retryOnNodeFailure: true,
        maxTaskRetries: 2,
        preferLocalExecution: true,
        mode: 'hybrid',
      },
    };

    manager = new NetworkManager('controller', identity, config);
  });

  describe('Streaming flow control', () => {
    it('should pause and resume streams', () => {
      const taskId = 'stream-task-1';

      expect(manager.isStreamPaused(taskId)).toBe(false);

      manager.pauseStream(taskId);
      expect(manager.isStreamPaused(taskId)).toBe(true);

      manager.resumeStream(taskId);
      expect(manager.isStreamPaused(taskId)).toBe(false);
    });

    it('should handle multiple stream pause/resume', () => {
      const task1 = 'stream-task-1';
      const task2 = 'stream-task-2';

      manager.pauseStream(task1);
      manager.pauseStream(task2);

      expect(manager.isStreamPaused(task1)).toBe(true);
      expect(manager.isStreamPaused(task2)).toBe(true);

      manager.resumeStream(task1);
      expect(manager.isStreamPaused(task1)).toBe(false);
      expect(manager.isStreamPaused(task2)).toBe(true);
    });
  });

  describe('Node metrics tracking', () => {
    it('should initialize and update node metrics', () => {
      const nodeId = 'worker-1';

      let metrics = manager.getNodeMetrics(nodeId);
      expect(metrics).toBeUndefined();

      manager.recordTaskResult(nodeId, true, 100);

      metrics = manager.getNodeMetrics(nodeId);
      expect(metrics).toBeDefined();
      expect(metrics?.successCount).toBe(1);
      expect(metrics?.failureCount).toBe(0);
      expect(metrics?.avgLatencyMs).toBe(100);
    });

    it('should calculate rolling average latency', () => {
      const nodeId = 'worker-2';

      manager.recordTaskResult(nodeId, true, 100);
      manager.recordTaskResult(nodeId, true, 200);
      manager.recordTaskResult(nodeId, true, 150);

      const metrics = manager.getNodeMetrics(nodeId);
      expect(metrics?.avgLatencyMs).toBe(150);
      expect(metrics?.rollingLatencies).toHaveLength(3);
    });

    it('should track success and failure rates', () => {
      const nodeId = 'worker-3';

      manager.recordTaskResult(nodeId, true, 100);
      manager.recordTaskResult(nodeId, true, 100);
      manager.recordTaskResult(nodeId, false, 100);
      manager.recordTaskResult(nodeId, true, 100);

      const metrics = manager.getNodeMetrics(nodeId);
      expect(metrics?.successCount).toBe(3);
      expect(metrics?.failureCount).toBe(1);
      expect(metrics?.successRate).toBe(0.75);
      expect(metrics?.errorRate).toBe(0.25);
    });

    it('should get all node metrics', () => {
      manager.recordTaskResult('node-1', true, 100);
      manager.recordTaskResult('node-2', true, 200);

      const allMetrics = manager.getAllNodeMetrics();
      expect(allMetrics.size).toBe(2);
    });
  });

  describe('TLS fingerprint validation', () => {
    it('should not throw when fingerprints not configured', () => {
      const configWithoutFingerprints: NetworkConfig = {
        ...config,
        security: {
          ...config.security,
          trustedFingerprints: undefined,
        },
      };

      const testManager = new NetworkManager('controller', identity, configWithoutFingerprints);
      const mockSocket = {
        on: () => {},
        remoteAddress: '127.0.0.1',
      };

      expect(() => testManager.handleIncomingConnection(mockSocket, {})).not.toThrow();
    });

    it('should accept valid fingerprint', () => {
      const configWithFingerprints: NetworkConfig = {
        ...config,
        security: {
          ...config.security,
          trustedFingerprints: ['SHA256:ABC123'],
        },
      };

      const testManager = new NetworkManager('controller', identity, configWithFingerprints);
      const mockSocket = {
        on: () => {},
        remoteAddress: '127.0.0.1',
        getPeerCertificate: () => ({ fingerprintSHA256: 'SHA256:ABC123' }),
      };

      expect(() => testManager.handleIncomingConnection(mockSocket, { socket: mockSocket })).not.toThrow();
    });

    it('should reject invalid fingerprint', () => {
      const configWithFingerprints: NetworkConfig = {
        ...config,
        security: {
          ...config.security,
          trustedFingerprints: ['SHA256:ABC123'],
        },
      };

      const testManager = new NetworkManager('controller', identity, configWithFingerprints);
      const rejectedEvents: unknown[] = [];
      testManager.on('network:connection-rejected', (data) => rejectedEvents.push(data));

      const mockSocket = {
        on: () => {},
        remoteAddress: '127.0.0.1',
        getPeerCertificate: () => ({ fingerprintSHA256: 'SHA256:WRONG' }),
      };

      testManager.handleIncomingConnection(mockSocket, { socket: mockSocket });

      expect(rejectedEvents.length).toBe(1);
      expect((rejectedEvents[0] as { reason: string }).reason).toBe('Invalid TLS fingerprint');
    });
  });
});
