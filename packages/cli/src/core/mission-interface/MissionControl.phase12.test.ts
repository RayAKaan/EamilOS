import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { MissionEngine } from '../mission/MissionEngine.js';
import { MissionStore } from '../mission/MissionStore.js';
import { MissionControl } from './MissionControl.js';
import { MissionPolicyStore } from './MissionPolicyStore.js';
import { ApprovalStore } from './ApprovalStore.js';

describe('MissionControl Phase 12 interface', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  function control() {
    const root = join(tmpdir(), 'eamilos-phase12-interface-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    roots.push(root);
    return new MissionControl(
      new MissionEngine(new MissionStore(join(root, 'missions'))),
      new MissionPolicyStore(join(root, 'policies')),
      new ApprovalStore(join(root, 'approvals')),
    );
  }

  it('renders a dashboard from authoritative mission state', async () => {
    const value = control();
    const mission = await value.create({ goal: 'Build a service', autonomy: 'AUTONOMOUS' });
    const dashboard = await value.dashboard(mission.id);
    expect(dashboard).toContain(mission.id);
    expect(dashboard).toContain('AUTONOMOUS');
    expect(dashboard).toContain('PROGRESS');
  });

  it('explains a task using deterministic graph provenance', async () => {
    const value = control();
    const mission = await value.create({ goal: 'Build a service' });
    const first = value.missions.addTask(mission.id, { id: 'task_a', title: 'Design', description: 'Design' });
    const second = value.missions.addTask(mission.id, { id: 'task_b', title: 'Implement', description: 'Implement', dependencies: [first.id] });
    const explanation = await value.why(mission.id, second.id);
    expect(explanation.dependencies.some((item: { id: string }) => item.id === first.id)).toBe(true);
  });

  it('verifies graph consistency and exposes mission events', async () => {
    const value = control();
    const mission = await value.create({ goal: 'Verify project' });
    const verification = await value.verify(mission.id);
    expect(verification.consistent).toBe(true);
    const events = await value.events(mission.id);
    expect(events.some(event => event.type === 'MISSION_CREATED')).toBe(true);
  });

  it('keeps human approvals persistent across control calls', async () => {
    const value = control();
    const mission = await value.create({ goal: 'Deploy safely', requireApprovalFor: ['START'] });
    const first = await value.start(mission.id);
    expect(first.started).toBe(false);
    expect(first.approval?.status).toBe('PENDING');
    await value.approve(mission.id, first.approval!.id);
    const second = await value.start(mission.id);
    expect(second.started).toBe(true);
  });
});
