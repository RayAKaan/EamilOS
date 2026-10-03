import { describe, expect, it } from 'vitest';
import {
  EamilosPtyManager,
  InMemoryPtyBackend,
  type PtySessionRequest,
} from './index.js';

function request(overrides: Partial<PtySessionRequest> = {}): PtySessionRequest {
  return {
    sessionId: 'pty-1',
    executionId: 'exec-1',
    missionId: 'mission-1',
    taskId: 'task-1',
    workerId: 'worker-1',
    agentId: 'agent-1',
    harnessId: 'harness-1',
    cwd: '/workspace',
    command: 'agent',
    args: ['--run'],
    ...overrides,
  };
}

describe('EamilosPtyManager', () => {
  it('creates an authoritative session and forwards backend lifecycle', async () => {
    const backend = new InMemoryPtyBackend();
    const manager = new EamilosPtyManager(backend);
    const events: string[] = [];

    manager.on('created', () => events.push('created'));
    manager.on('started', () => events.push('started'));
    manager.on('completed', () => events.push('completed'));

    const session = await manager.create(request());

    expect(session.sessionId).toBe('pty-1');
    expect(session.executionId).toBe('exec-1');
    expect(session.state).toBe('running');
    expect(events).toEqual(['created', 'started']);

    backend.emitData('pty-1', 'stdout', 'hello');
    expect(manager.get('pty-1')?.state).toBe('running');

    backend.exit('pty-1', 0);
    expect(manager.get('pty-1')?.state).toBe('completed');
    expect(events).toEqual(['created', 'started', 'completed']);

    manager.close();
  });

  it('keeps terminal IO backend-neutral', async () => {
    const backend = new InMemoryPtyBackend();
    const manager = new EamilosPtyManager(backend);

    await manager.create(request());
    manager.write('pty-1', 'hello\n');
    manager.resize('pty-1', { cols: 100, rows: 30 });
    manager.terminate('pty-1', 'SIGTERM');

    const session = backend.get('pty-1')!;
    expect(session.writes).toEqual(['hello\n']);
    expect(session.resizeHistory.at(-1)).toEqual({ cols: 100, rows: 30 });
    expect(session.terminationSignals).toEqual(['SIGTERM']);
  });

  it('rejects duplicate sessions and invalid dimensions', async () => {
    const backend = new InMemoryPtyBackend();
    const manager = new EamilosPtyManager(backend);

    await manager.create(request());
    await expect(manager.create(request())).rejects.toThrow('PTY session already exists');

    expect(() => manager.resize('pty-1', { cols: 0, rows: 20 }))
      .toThrow('PTY columns must be a positive integer');
  });

  it('supports attach and detach without making the TUI authoritative', async () => {
    const backend = new InMemoryPtyBackend();
    const manager = new EamilosPtyManager(backend);
    const attached: string[] = [];
    const detached: string[] = [];

    manager.on('attached', (session) => attached.push(session.sessionId));
    manager.on('detached', (session) => detached.push(session.sessionId));

    await manager.create(request());
    const attachedSession = await manager.attach('pty-1');
    expect(attachedSession.state).toBe('attached');

    manager.detach('pty-1');
    expect(manager.get('pty-1')?.state).toBe('idle');
    expect(attached).toEqual(['pty-1']);
    expect(detached).toEqual(['pty-1']);
  });

  it('propagates failed exits and cleans backend subscriptions', async () => {
    const backend = new InMemoryPtyBackend();
    const manager = new EamilosPtyManager(backend);

    await manager.create(request());
    backend.exit('pty-1', 17, 'SIGTERM');

    expect(manager.get('pty-1')?.state).toBe('failed');
    expect(manager.get('pty-1')?.exitCode).toBe(17);
    expect(manager.get('pty-1')?.signal).toBe('SIGTERM');

    manager.close();
    expect(manager.list()).toEqual([]);
  });
});
