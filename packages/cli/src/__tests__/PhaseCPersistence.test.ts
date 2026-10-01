import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MissionEventStore } from '../core/runtime/MissionEventStore.js';
import { MissionProjection } from '../core/runtime/MissionProjection.js';
import { MissionReplay } from '../core/runtime/MissionReplay.js';
import { MissionRecovery } from '../core/runtime/MissionRecovery.js';

async function makeStore() {
  return new MissionEventStore({ root: await mkdtemp(join(tmpdir(), 'eamilos-phase-c-')) });
}

describe('Phase C persistence, replay and recovery', () => {
  it('persists and verifies an append-only mission event chain', async () => {
    const store = await makeStore();
    await store.append({ missionId: 'm1', type: 'runtime.started', actor: 'test', payload: {} });
    await store.append({ missionId: 'm1', type: 'planning.requested', actor: 'test', payload: {} });
    const verification = await store.verify('m1');
    expect(verification).toMatchObject({ valid: true, count: 2 });
  });

  it('replays through a projection', async () => {
    const store = await makeStore();
    await store.append({ missionId: 'm2', type: 'runtime.started', actor: 'test', payload: {} });
    await store.append({ missionId: 'm2', type: 'execution.started', taskId: 't1', executionId: 'e1', actor: 'agent', payload: {} });
    const projection: MissionProjection<number> = {
      id: 'count-executions',
      initial: () => 0,
      apply: (state, event) => event.type === 'execution.started' ? state + 1 : state,
    };
    const replay = new MissionReplay(store);
    const result = await replay.run('m2', projection);
    expect(result.state).toBe(1);
    expect(result.eventsApplied).toBe(2);
  });

  it('creates checkpoints and resumes replay from them', async () => {
    const store = await makeStore();
    await store.append({ missionId: 'm3', type: 'runtime.started', actor: 'test' });
    await store.append({ missionId: 'm3', type: 'planning.requested', actor: 'test' });
    const checkpoint = await store.checkpoint('m3', { value: 2 });
    expect(checkpoint?.sequence).toBe(1);
    const loaded = await store.loadCheckpoint<{ value: number }>('m3');
    expect(loaded?.state.value).toBe(2);
  });

  it('forks a mission with provenance', async () => {
    const store = await makeStore();
    await store.append({ missionId: 'source', type: 'runtime.started', actor: 'test' });
    await store.append({ missionId: 'source', type: 'planning.requested', actor: 'test' });
    await store.fork('source', 'forked', 0);
    const events = await store.load('forked');
    expect(events).toHaveLength(1);
    expect(events[0].missionId).toBe('forked');
    expect(events[0].payload.forkedFrom).toMatchObject({ missionId: 'source', sequence: 0 });
  });

  it('reconstructs mission state after a runtime restart', async () => {
    const store = await makeStore();
    await store.append({ missionId: 'm4', type: 'runtime.started', actor: 'runtime' });
    await store.append({ missionId: 'm4', type: 'execution.started', taskId: 't1', executionId: 'e1', actor: 'agent' });
    const recovery = new MissionRecovery(store);
    const report = await recovery.recover('m4');
    expect(report.valid).toBe(true);
    expect(report.reconstructed).toBe(true);
    expect((report.state as { activeExecutions: string[] }).activeExecutions).toContain('e1');
  });
});
