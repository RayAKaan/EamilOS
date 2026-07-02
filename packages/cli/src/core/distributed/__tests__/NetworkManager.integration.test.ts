import { describe, it, expect, vi, afterAll } from 'vitest';
import { NetworkManager } from '../NetworkManager.js';
import { NodeCapabilityScanner } from '../NodeCapabilityScanner.js';

function makeConfig(port: number, sharedKey: string) {
  return {
    security: {
      sharedKey,
      sessionTimeoutMs: 60000,
      requireSignedMessages: true,
      maxConnectionAttempts: 5,
      banDurationMs: 60000,
    },
    heartbeat: {
      intervalMs: 5000,
      timeoutMs: 15000,
      missedBeforeDisconnect: 3,
    },
    execution: {
      taskTimeoutMs: 30000,
      retryOnNodeFailure: true,
      maxTaskRetries: 1,
      preferLocalExecution: true,
      mode: 'hybrid' as const,
    },
    worker: { port, host: '127.0.0.1' as const },
  };
}

describe('NetworkManager real transport', () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('controller receives real capabilities from a live worker over a real socket', async () => {
    const mockCaps = {
      cpuCores: 16,
      totalRAMBytes: 34359738368,
      availableRAMBytes: 17179869184,
      gpus: [],
      providers: [],
      models: [{ modelId: 'qwen2.5-coder:7b', provider: 'ollama', loaded: true, maxContextLength: 8192 }],
      maxConcurrentTasks: 4,
      currentLoad: 0,
      platform: 'linux',
      arch: 'x64',
    };
    vi.spyOn(NodeCapabilityScanner, 'scan').mockResolvedValue(mockCaps);

    const port = 17890 + Math.floor(Math.random() * 1000);
    const sharedKey = 'test-shared-key';

    const worker = new NetworkManager(
      'worker',
      { id: 'w1', name: 'test-worker', role: 'worker', version: '1.0.0', startedAt: Date.now() },
      makeConfig(port, sharedKey)
    );
    await worker.startWorker(port);

    const controller = new NetworkManager(
      'controller',
      { id: 'c1', name: 'test-controller', role: 'controller', version: '1.0.0', startedAt: Date.now() },
      makeConfig(port, sharedKey)
    );

    const status = await controller.connectToWorker(`ws://127.0.0.1:${port}`, 'test-worker');

    expect(status.capabilities.cpuCores).toBe(16);
    expect(status.capabilities.models[0].modelId).toBe('qwen2.5-coder:7b');
    expect(status.capabilities.platform).toBe('linux');

    await controller.shutdown();
    await worker.shutdown();
  });

  it('startWorker rejects a second bind on the same port', async () => {
    const port = 17890 + Math.floor(Math.random() * 1000) + 2000;
    const cfg = makeConfig(port, 'k');

    const w1 = new NetworkManager(
      'worker',
      { id: 'w1', name: 'w1', role: 'worker', version: '1.0.0', startedAt: Date.now() },
      cfg
    );
    await w1.startWorker(port);

    const w2 = new NetworkManager(
      'worker',
      { id: 'w2', name: 'w2', role: 'worker', version: '1.0.0', startedAt: Date.now() },
      cfg
    );
    await expect(w2.startWorker(port)).rejects.toThrow(/already in use/);

    await w1.shutdown();
  });
});
