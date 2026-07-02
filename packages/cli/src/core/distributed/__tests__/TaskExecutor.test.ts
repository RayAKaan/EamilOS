import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskExecutor } from '../TaskExecutor.js';
import { EventEmitter } from 'events';
import type { RemoteTaskPayload } from '../types.js';
import { NodeCapabilityScanner } from '../NodeCapabilityScanner.js';

vi.mock('../NodeCapabilityScanner.js', () => ({
  NodeCapabilityScanner: {
    scan: vi.fn().mockResolvedValue({
      nodeId: 'worker-1',
      hostname: 'test-host',
      cpu: { cores: 4, model: 'Intel', speed: 3000 },
      memory: { totalMB: 8192, freeMB: 4096 },
      models: [
        { modelId: 'gpt-4', name: 'GPT-4', available: true },
        { modelId: 'gpt-3.5-turbo', name: 'GPT-3.5', available: true },
      ],
      maxConcurrentTasks: 3,
      currentLoad: 0,
      os: { platform: 'linux', arch: 'x64' },
    }),
  },
}));

function makeFakeNetworkManager() {
  const nm = Object.assign(new EventEmitter(), {
    identity_: { id: 'worker-1', hostname: 'test-host' } as any,
    sendMessage: vi.fn(),
    socket_: { on: vi.fn() } as any,
  } as any);
  return nm;
}

function makeTaskPayload(overrides?: Partial<RemoteTaskPayload>): RemoteTaskPayload {
  return {
    taskId: 'task-123',
    task: { description: 'echo hello', type: 'execution' },
    agent: { id: 'opencode', type: 'cli', role: 'executor', model: 'gpt-4' },
    contextMessages: [{ role: 'user', content: 'do something' }],
    executionConfig: { timeout: 5000 },
    ...overrides,
  } as RemoteTaskPayload;
}

describe('TaskExecutor', () => {
  let nm: ReturnType<typeof makeFakeNetworkManager>;
  let executor: TaskExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    nm = makeFakeNetworkManager();
    executor = new TaskExecutor(nm);
  });

  it('should have 0 active tasks initially', () => {
    expect(executor.activeTaskCount).toBe(0);
    expect(executor.isRunning('task-123')).toBe(false);
  });

  it('should send task:accepted on successful execution', async () => {
    // AgentFactory.createAdapter returns null for unknown agents,
    // so we need to mock it
    const { AgentFactory } = await import('../../agents/AgentFactory.js');
    vi.spyOn(AgentFactory, 'createAdapter').mockReturnValue({
      id: 'mock-agent',
      name: 'Mock',
      run: vi.fn().mockResolvedValue({
        agentId: 'mock-agent',
        success: true,
        content: 'hello world',
        fileChanges: [],
        durationMs: 100,
      }),
      stop: vi.fn(),
    } as any);

    await executor.execute(makeTaskPayload(), {} as any);

    expect(nm.sendMessage).toHaveBeenCalledWith(
      {},
      'task:accepted',
      expect.objectContaining({ taskId: 'task-123' })
    );

    vi.restoreAllMocks();
  });

  it('should send task:rejected when agent is unknown', async () => {
    const { AgentFactory } = await import('../../agents/AgentFactory.js');
    vi.spyOn(AgentFactory, 'createAdapter').mockReturnValue(null);

    await executor.execute(makeTaskPayload({ agent: { id: 'nonexistent', type: 'unknown', role: 'executor' } }), {} as any);

    expect(nm.sendMessage).toHaveBeenCalledWith(
      {},
      'task:error',
      expect.objectContaining({ taskId: 'task-123' })
    );

    vi.restoreAllMocks();
  });

  it('should send task:error on agent run failure', async () => {
    const { AgentFactory } = await import('../../agents/AgentFactory.js');
    vi.spyOn(AgentFactory, 'createAdapter').mockReturnValue({
      id: 'fail-agent',
      name: 'Fail',
      run: vi.fn().mockRejectedValue(new Error('Agent crashed')),
      stop: vi.fn(),
    } as any);

    await executor.execute(makeTaskPayload(), {} as any);

    expect(nm.sendMessage).toHaveBeenCalledWith(
      {},
      'task:error',
      expect.objectContaining({
        taskId: 'task-123',
        error: 'Agent crashed',
        success: false,
      })
    );

    vi.restoreAllMocks();
  });

  it('should emit worker:task-completed on success', async () => {
    const { AgentFactory } = await import('../../agents/AgentFactory.js');
    vi.spyOn(AgentFactory, 'createAdapter').mockReturnValue({
      id: 'ok-agent',
      name: 'OK',
      run: vi.fn().mockResolvedValue({
        agentId: 'ok-agent',
        success: true,
        content: 'done',
        fileChanges: [],
        durationMs: 50,
      }),
      stop: vi.fn(),
    } as any);

    const completedFn = vi.fn();
    nm.on('worker:task-completed', completedFn);

    await executor.execute(makeTaskPayload(), {} as any);

    expect(completedFn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-123', agentId: 'opencode' })
    );

    vi.restoreAllMocks();
  });

  it('should emit worker:task-failed on error', async () => {
    const { AgentFactory } = await import('../../agents/AgentFactory.js');
    vi.spyOn(AgentFactory, 'createAdapter').mockReturnValue({
      id: 'boom',
      name: 'Boom',
      run: vi.fn().mockRejectedValue(new Error('kaboom')),
      stop: vi.fn(),
    } as any);

    const failedFn = vi.fn();
    nm.on('worker:task-failed', failedFn);

    await executor.execute(makeTaskPayload(), {} as any);

    expect(failedFn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-123', error: 'kaboom' })
    );

    vi.restoreAllMocks();
  });

  it('should emit distribution:task-error on failure', async () => {
    const { AgentFactory } = await import('../../agents/AgentFactory.js');
    vi.spyOn(AgentFactory, 'createAdapter').mockReturnValue({
      id: 'boom',
      run: vi.fn().mockRejectedValue(new Error('fail')),
      stop: vi.fn(),
    } as any);

    const distErrFn = vi.fn();
    nm.on('distribution:task-error', distErrFn);

    await executor.execute(makeTaskPayload(), {} as any);

    expect(distErrFn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-123', error: 'fail' })
    );

    vi.restoreAllMocks();
  });

  it('cancel should call agent.stop and remove from active', async () => {
    const stopFn = vi.fn();
    const { AgentFactory } = await import('../../agents/AgentFactory.js');
    vi.spyOn(AgentFactory, 'createAdapter').mockReturnValue({
      id: 'slow',
      run: vi.fn().mockImplementation(() => new Promise(() => {})), // never resolves
      stop: stopFn,
    } as any);

    // Start execute in background (it will hang on the mock promise)
    const execPromise = executor.execute(makeTaskPayload(), {} as any);

    // Wait long enough for execute to reach activeAgents.set()
    await new Promise(r => setTimeout(r, 50));

    // Verify the agent is now tracked
    expect(executor.isRunning('task-123')).toBe(true);

    await executor.cancel('task-123');

    expect(stopFn).toHaveBeenCalled();
    expect(executor.isRunning('task-123')).toBe(false);

    vi.restoreAllMocks();
  });
});
