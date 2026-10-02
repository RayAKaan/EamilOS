import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecutionStore } from './ExecutionStore.js';

describe('ExecutionStore', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  it('persists atomically and restores checkpoints', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eamilos-execution-'));
    tempDirs.push(dir);
    const file = join(dir, 'executions.json');
    const store = new ExecutionStore(file);

    await store.upsert({
      id: 'exec-1',
      taskId: 'task-1',
      agentId: 'opencode',
      startedAt: 1,
      status: 'running',
      prompt: 'do work',
    });
    await store.checkpoint('exec-1', 'partial output');

    const restored = new ExecutionStore(file);
    await restored.load();
    expect(restored.get('exec-1')?.status).toBe('recovering');
    expect(restored.getCheckpoint('exec-1')).toBe('partial output');
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveLength(1);
  });
});
