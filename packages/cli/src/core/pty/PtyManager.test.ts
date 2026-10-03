import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryPtySessionStore, SqlitePtySessionStore } from './PtySessionStore.js';
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

  it('distinguishes an explicit termination from a failed exit', async () => {
    const backend = new InMemoryPtyBackend();
    const manager = new EamilosPtyManager(backend);
    const terminated: string[] = [];

    manager.on('terminated', (event) => terminated.push(event.sessionId));
    await manager.create(request());
    manager.terminate('pty-1', 'SIGTERM');
    backend.exit('pty-1', null, 'SIGTERM');

    expect(manager.get('pty-1')?.state).toBe('terminated');
    expect(terminated).toEqual(['pty-1']);
    manager.close();
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
  it('applies an execution policy before creating a backend process', async () => {
    const backend = new InMemoryPtyBackend();
    const policy = new (await import('./PtyExecutionPolicy.js')).DefaultPtyExecutionPolicy({
      allowedCommands: ['approved-agent'],
    });
    const manager = new EamilosPtyManager(backend, new InMemoryPtySessionStore(), policy);

    await expect(manager.create(request({ command: 'blocked-agent' })))
      .rejects.toThrow('PTY command is not allowed by execution policy');
    expect(manager.list()).toEqual([]);
    manager.close();
  });

  it('provides an explicit shutdown path without pretending orphaned sessions completed', async () => {
    const backend = new InMemoryPtyBackend();
    const manager = new EamilosPtyManager(backend);

    await manager.create(request({ sessionId: 'shutdown-1' }));
    manager.shutdown('SIGTERM');

    expect(backend.get('shutdown-1')?.terminationSignals).toEqual(['SIGTERM']);
    expect(manager.list()).toEqual([]);
  });

  it('suppresses duplicate terminal events from a misbehaving backend', async () => {
    const backend = new InMemoryPtyBackend();
    const manager = new EamilosPtyManager(backend);
    let completed = 0;

    manager.on('completed', () => completed++);
    await manager.create(request({ sessionId: 'duplicate-exit-1' }));
    backend.exit('duplicate-exit-1', 0);
    backend.exit('duplicate-exit-1', 0);

    expect(completed).toBe(1);
    expect(manager.get('duplicate-exit-1')?.state).toBe('completed');
    manager.close();
  });

});


describe('EamilosPtyManager durable recovery', () => {
  it('persists active sessions as orphaned across manager restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eamilos-pty-'));
    const filename = join(dir, 'pty.db');

    try {
      const storeA = new SqlitePtySessionStore({ filename });
      const backendA = new InMemoryPtyBackend();
      const managerA = new EamilosPtyManager(backendA, storeA);
      await managerA.create(request({ sessionId: 'restart-1' }));
      managerA.close();

      const storeB = new SqlitePtySessionStore({ filename });
      const managerB = new EamilosPtyManager(new InMemoryPtyBackend(), storeB);

      expect(managerB.get('restart-1')?.state).toBe('orphaned');
      managerB.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recovers an orphaned session when the backend can still attach', async () => {
    const store = new InMemoryPtySessionStore();
    const backend = new InMemoryPtyBackend();
    const managerA = new EamilosPtyManager(backend, store);
    await managerA.create(request({ sessionId: 'recover-1' }));

    // Simulate a manager restart while the backend process remains available.
    managerA.close();

    const managerB = new EamilosPtyManager(backend, store);
    const recovered = await managerB.recover('recover-1');

    expect(recovered.state).toBe('attached');
    expect(recovered.pid).toBe(0);
    managerB.close();
  });

  it('marks an orphaned session lost when the backend cannot attach', async () => {
    const store = new InMemoryPtySessionStoreForTest();
    const backendA = new InMemoryPtyBackend();
    const managerA = new EamilosPtyManager(backendA, store);
    await managerA.create(request({ sessionId: 'lost-1' }));
    managerA.close();

    const managerB = new EamilosPtyManager(new InMemoryPtyBackend(), store);
    await expect(managerB.recover('lost-1')).rejects.toThrow('PTY backend session not found');
    expect(managerB.get('lost-1')?.state).toBe('lost');
    managerB.close();
  });
});

class InMemoryPtySessionStoreForTest extends (await import('./PtySessionStore.js')).InMemoryPtySessionStore {}
