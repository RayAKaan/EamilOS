import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EamilosSqliteCheckpointStore, StaleCheckpointError, assertCheckpointFresh } from './EamilosCheckpointStore.js';

const hash = 'a'.repeat(64);
function input(overrides: Record<string, unknown> = {}) {
  return {
    missionId: 'm1', taskId: 't1', executionId: 'e1', workerId: 'w1', graphVersion: 1,
    contextVersion: 1, contextHash: hash, fencingToken: 1, state: { step: 1 }, ...overrides,
  } as any;
}

describe('EamilosSqliteCheckpointStore', () => {
  it('persists lineage and resumes latest checkpoint after restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eamilos-checkpoint-'));
    const filename = join(dir, 'checkpoints.sqlite');
    try {
      const firstStore = new EamilosSqliteCheckpointStore({ filename });
      const first = firstStore.save(input());
      const second = firstStore.save(input({ state: { step: 2 }, expectedParentCheckpointId: first.checkpointId }));
      expect(second.sequence).toBe(2);
      expect(second.parentCheckpointId).toBe(first.checkpointId);
      firstStore.close();

      const recovered = new EamilosSqliteCheckpointStore({ filename });
      expect(recovered.latest('e1')?.checkpointId).toBe(second.checkpointId);
      expect(recovered.latest('e1')?.state).toEqual({ step: 2 });
      expect(recovered.list('e1')).toHaveLength(2);
      recovered.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects stale parent writers and regressed fencing tokens', () => {
    const store = new EamilosSqliteCheckpointStore({ filename: ':memory:' });
    const first = store.save(input({ fencingToken: 2 }));
    expect(() => store.save(input({ state: { step: 2 }, expectedParentCheckpointId: 'old' }))).toThrow(StaleCheckpointError);
    expect(() => store.save(input({ state: { step: 2 }, expectedParentCheckpointId: first.checkpointId, fencingToken: 1 }))).toThrow(StaleCheckpointError);
    store.close();
  });

  it('rejects stale graph, context, and fencing on resume', () => {
    const store = new EamilosSqliteCheckpointStore({ filename: ':memory:' });
    const checkpoint = store.save(input({ fencingToken: 4 }));
    expect(() => assertCheckpointFresh(checkpoint, { missionId: 'm1', taskId: 't1', executionId: 'e1', graphVersion: 2, contextHash: hash })).toThrow(StaleCheckpointError);
    expect(() => assertCheckpointFresh(checkpoint, { missionId: 'm1', taskId: 't1', executionId: 'e1', graphVersion: 1, contextHash: 'b'.repeat(64) })).toThrow(StaleCheckpointError);
    expect(() => assertCheckpointFresh(checkpoint, { missionId: 'm1', taskId: 't1', executionId: 'e1', graphVersion: 1, contextHash: hash, minimumFencingToken: 5 })).toThrow(StaleCheckpointError);
    expect(() => assertCheckpointFresh(checkpoint, { missionId: 'm1', taskId: 't1', executionId: 'e1', graphVersion: 1, contextHash: hash, minimumFencingToken: 4 })).not.toThrow();
    store.close();
  });

  it('keeps independent checkpoint sequences per execution', () => {
    const store = new EamilosSqliteCheckpointStore({ filename: ':memory:' });
    expect(store.save(input()).sequence).toBe(1);
    expect(store.save(input({ executionId: 'e2' })).sequence).toBe(1);
    store.close();
  });
});
