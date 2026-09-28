import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { MissionEngine } from '../mission/MissionEngine.js';
import { MissionStore } from '../mission/MissionStore.js';
import { MissionControl } from './MissionControl.js';
import { MissionPolicyStore } from './MissionPolicyStore.js';
import { ApprovalStore } from './ApprovalStore.js';

describe('MissionControl', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  function control() {
    const root = join(tmpdir(), `eamilos-phase12-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    roots.push(root);
    const missions = new MissionEngine(new MissionStore(join(root, 'missions')));
    return new MissionControl(
      missions,
      new MissionPolicyStore(join(root, 'policies')),
      new ApprovalStore(join(root, 'approvals')),
    );
  }

  it('creates a mission with a deterministic autonomy policy', async () => {
    const value = control();
    const mission = await value.create({ goal: 'Build an API', autonomy: 'PLANNED' });
    const policy = await value.getPolicy(mission.id);
    expect(mission.status).toBe('created');
    expect(policy.autonomy).toBe('PLANNED');
    expect(policy.requireApprovalFor).toContain('EXECUTE');
  });

  it('pauses and cancels missions through the authoritative MissionEngine', async () => {
    const value = control();
    const mission = await value.create({ goal: 'Inspect repository' });
    value.missions.start(mission.id);
    const paused = await value.pause(mission.id);
    expect(paused.status).toBe('paused');
    const cancelled = await value.cancel(mission.id);
    expect(cancelled.status).toBe('cancelled');
  });

  it('creates a pending start approval instead of bypassing human control', async () => {
    const value = control();
    const mission = await value.create({ goal: 'Deploy application', requireApprovalFor: ['START'] });
    const result = await value.start(mission.id);
    expect(result.started).toBe(false);
    expect(result.approval?.status).toBe('PENDING');
    expect(value.missions.snapshot(mission.id).mission.status).toBe('created');
  });

  it('supports bounded natural-language status and blocker queries', async () => {
    const value = control();
    const mission = await value.create({ goal: 'Test mission' });
    const status = await value.ask(mission.id, 'status');
    expect(status.intent).toBe('STATUS');
    const blockers = await value.ask(mission.id, 'what is blocking the mission');
    expect(blockers.intent).toBe('BLOCKERS');
  });

  it('consumes an approval exactly once', async () => {
    const store = new ApprovalStore(join(roots[0] ?? tmpdir(), 'approvals-standalone'));
    const first = await store.request({ missionId: 'm1', action: 'EXECUTE', reason: 'Run task' });
    await store.resolve('m1', first.id, true);
    expect(await store.consumeApproved('m1', 'EXECUTE')).toBeDefined();
    expect(await store.consumeApproved('m1', 'EXECUTE')).toBeUndefined();
  });
});
