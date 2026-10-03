import { describe, expect, it } from 'vitest';
import { EamilosPtyManager, InMemoryPtyBackend } from './PtyManager.js';
import { MultiTerminalProjection } from './MultiTerminalProjection.js';

function request(sessionId: string) {
  return {
    sessionId,
    executionId: `execution-${sessionId}`,
    missionId: 'mission-1',
    taskId: `task-${sessionId}`,
    workerId: 'worker-1',
    agentId: `agent-${sessionId}`,
    harnessId: 'harness-1',
    cwd: '/workspace',
    command: 'agent',
    args: [],
  };
}

describe('MultiTerminalProjection', () => {
  it('projects multiple PTYs without owning their lifecycle', async () => {
    const backend = new InMemoryPtyBackend();
    const manager = new EamilosPtyManager(backend);
    await manager.create(request('pty-a'));
    await manager.create(request('pty-b'));

    const projection = new MultiTerminalProjection(manager);

    expect(projection.snapshot().terminals).toHaveLength(2);
    expect(projection.selected()?.session.agentId).toBe('agent-pty-a');

    projection.select('pty-b');
    expect(projection.selected()?.session.agentId).toBe('agent-pty-b');

    projection.close();
    expect(manager.get('pty-b')?.state).toBe('running');
    manager.close();
  });

  it('captures bounded terminal output and follows PTY lifecycle changes', async () => {
    const backend = new InMemoryPtyBackend();
    const manager = new EamilosPtyManager(backend);
    await manager.create(request('pty-a'));

    const projection = new MultiTerminalProjection(manager, { maxOutputChunks: 2 });
    backend.emitData('pty-a', 'stdout', 'one');
    backend.emitData('pty-a', 'stdout', 'two');
    backend.emitData('pty-a', 'stderr', 'three');

    const terminal = projection.selected()!;
    expect(terminal.output.map(chunk => chunk.data)).toEqual(['two', 'three']);

    backend.exit('pty-a', 0);
    expect(projection.selected()?.session.state).toBe('completed');

    projection.close();
    manager.close();
  });

  it('supports deterministic next/previous terminal focus', async () => {
    const manager = new EamilosPtyManager(new InMemoryPtyBackend());
    await manager.create(request('pty-b'));
    await manager.create(request('pty-a'));

    const projection = new MultiTerminalProjection(manager);
    expect(projection.snapshot().selectedSessionId).toBe('pty-b');

    projection.selectNext();
    expect(projection.snapshot().selectedSessionId).toBe('pty-a');

    projection.selectPrevious();
    expect(projection.snapshot().selectedSessionId).toBe('pty-b');

    projection.close();
    manager.close();
  });
});
