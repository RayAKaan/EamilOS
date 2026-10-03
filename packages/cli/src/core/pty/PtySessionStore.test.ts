import { describe, expect, it } from 'vitest';
import { InMemoryPtySessionStore, SqlitePtySessionStore } from './PtySessionStore.js';
import type { PtySession } from './PtyTypes.js';

const session: PtySession = Object.freeze({
  sessionId: 'pty-store-1',
  executionId: 'exec-1',
  missionId: 'mission-1',
  taskId: 'task-1',
  workerId: 'worker-1',
  agentId: 'agent-1',
  harnessId: 'harness-1',
  cwd: '/workspace',
  command: 'agent',
  args: Object.freeze(['--run']),
  state: 'running',
  dimensions: Object.freeze({ cols: 120, rows: 40 }),
  createdAt: '2026-10-03T00:00:00.000Z',
  startedAt: '2026-10-03T00:00:01.000Z',
  pid: 42,
});

describe.each([
  ['memory', () => new InMemoryPtySessionStore()],
  ['sqlite', () => new SqlitePtySessionStore({ filename: ':memory:' })],
])('%s PTY session store', (_name, create) => {
  it('persists and lists immutable session metadata', () => {
    const store = create();
    store.save(session);

    expect(store.get(session.sessionId)).toEqual(session);
    expect(store.list()).toEqual([session]);
    store.close();
  });

  it('updates lifecycle state without replacing identity', () => {
    const store = create();
    store.save(session);

    const completed = Object.freeze({
      ...session,
      state: 'completed' as const,
      completedAt: '2026-10-03T00:01:00.000Z',
      exitCode: 0,
      signal: null,
    });
    store.save(completed);

    expect(store.get(session.sessionId)?.state).toBe('completed');
    expect(store.get(session.sessionId)?.executionId).toBe('exec-1');
    store.close();
  });
});
