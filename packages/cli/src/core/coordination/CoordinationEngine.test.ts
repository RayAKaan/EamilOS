import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { MissionEngine } from '../mission/MissionEngine.js';
import { MissionStore } from '../mission/MissionStore.js';
import { CoordinationStore } from './CoordinationStore.js';
import { CoordinationEngine } from './CoordinationEngine.js';
import { ProposalReconciler } from './ProposalReconciler.js';
import type { TaskProposal } from './types.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'eamilos-1-5-'));
  const missions = new MissionEngine(new MissionStore(join(dir, 'missions')));
  const coordination = new CoordinationEngine(missions, new CoordinationStore(join(dir, 'coordination')));
  const mission = missions.createMission({ id: 'm15', goal: 'Phase 1.5', workingDir: dir });
  return { dir, missions, coordination, mission };
}


function proposal(overrides: Partial<TaskProposal> = {}): TaskProposal {
  return {
    proposalId: 'p1',
    missionId: 'm15',
    agentId: 'agent-a',
    baseGraphVersion: 0,
    title: 'Implement API',
    objective: 'Implement the API',
    dependencies: [],
    priority: 'HIGH',
    requiredCapabilities: ['typescript'],
    acceptanceCriteria: ['tests pass'],
    readSet: [{ id: 'src/index.ts', kind: 'file', mode: 'read' }],
    writeSet: [{ id: 'src/api.ts', kind: 'file', mode: 'write' }],
    idempotencyKey: 'api',
    orderingAfter: [],
    createdAt: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

describe('Phase 1.5 coordination', () => {
  it('materializes Laya-style proposals into the authoritative mission graph', () => {
    const { dir, missions, coordination, mission } = setup();
    const result = coordination.submitProposals(mission.id, [proposal()]);
    expect(result.accepted).toHaveLength(1);
    expect(missions.snapshot(mission.id).tasks).toHaveLength(1);
    expect(coordination.snapshot(mission.id).version.graphVersion).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('merges duplicate proposals by idempotency key', () => {
    const { dir, coordination, mission } = setup();
    const first = coordination.submitProposals(mission.id, [proposal()]);
    const second = coordination.submitProposals(mission.id, [proposal({ proposalId: 'p2' })]);
    expect(first.accepted).toHaveLength(1);
    expect(second.merged).toEqual(['p2']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps independent read/read plans parallel', () => {
    const { dir, coordination, mission } = setup();
    const a = proposal({ proposalId: 'a', agentId: 'a1', writeSet: [], idempotencyKey: 'a', globalTaskId: 'task-a' });
    const b = proposal({ proposalId: 'b', agentId: 'b1', writeSet: [], idempotencyKey: 'b', globalTaskId: 'task-b', readSet: [{ id: 'shared', kind: 'file', mode: 'read' }] });
    coordination.submitProposals(mission.id, [a, b]);
    const plans = coordination.activeAgentPlans(mission.id);
    expect(plans).toHaveLength(0);
    const reconciler = new ProposalReconciler();
    expect(reconciler.reconcile(b, [a], []).action).toBe('ACCEPT');
    rmSync(dir, { recursive: true, force: true });
  });

  it('reschedules a read/write overlap without arbitrary write ordering', () => {
    const { dir, coordination, mission } = setup();
    const a = proposal({ proposalId: 'a', agentId: 'a1', idempotencyKey: 'a', globalTaskId: 'task-a', writeSet: [{ id: 'shared', kind: 'file', mode: 'write' }] });
    const b = proposal({ proposalId: 'b', agentId: 'b1', idempotencyKey: 'b', globalTaskId: 'task-b', readSet: [{ id: 'shared', kind: 'file', mode: 'read' }], writeSet: [] });
    coordination.submitProposals(mission.id, [a]);
    const result = coordination.submitProposals(mission.id, [b]);
    expect(result.rescheduled).toEqual(['b']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('escalates independent conflicting writes to Jev', () => {
    const { dir, coordination, mission } = setup();
    const a = proposal({ proposalId: 'a', agentId: 'a1', idempotencyKey: 'a', globalTaskId: 'task-a', writeSet: [{ id: 'shared', kind: 'file', mode: 'write' }] });
    const b = proposal({ proposalId: 'b', agentId: 'b1', idempotencyKey: 'b', globalTaskId: 'task-b', writeSet: [{ id: 'shared', kind: 'file', mode: 'write' }] });
    coordination.submitProposals(mission.id, [a]);
    const result = coordination.submitProposals(mission.id, [b]);
    expect(result.escalations).toEqual(['b']);
    expect(result.results[0].escalateToJev).toBe(true);
    expect(coordination.snapshot(mission.id).proposals.map((p) => p.proposalId)).toEqual(['a']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('sequences a conflict when an explicit dependency exists', () => {
    const { dir, coordination, mission } = setup();
    const a = proposal({ proposalId: 'a', agentId: 'a1', idempotencyKey: 'a', globalTaskId: 'task-a', writeSet: [{ id: 'shared', kind: 'file', mode: 'write' }] });
    const b = proposal({ proposalId: 'b', agentId: 'b1', idempotencyKey: 'b', globalTaskId: 'task-b', dependencies: ['task-a'], writeSet: [{ id: 'shared', kind: 'file', mode: 'write' }] });
    coordination.submitProposals(mission.id, [a]);
    const result = coordination.submitProposals(mission.id, [b]);
    expect(result.results[0].action).toBe('SEQUENCE');
    expect(missions.snapshot(mission.id).tasks[1].dependencies).toEqual(['task-a']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reschedules stale local plans instead of mutating the authoritative graph', () => {
    const { dir, coordination, mission, missions } = setup();
    const result = coordination.submitProposals(mission.id, [proposal()]);
    const task = result.accepted[0].globalTaskId!;
    const plan = coordination.buildLocalPlan(mission.id, 'agent-a', [task]);
    coordination.submitProposals(mission.id, [proposal({ proposalId: 'p2', idempotencyKey: 'different', globalTaskId: 'task-2', agentId: 'agent-b', title: 'Second', objective: 'Second', writeSet: [{ id: 'src/other.ts', kind: 'file', mode: 'write' }] })]);
    const before = missions.snapshot(mission.id).tasks.length;
    const results = coordination.reconcileLocalPlan(mission.id, plan);
    expect(results[0].action).toBe('RESCHEDULE');
    expect(missions.snapshot(mission.id).tasks).toHaveLength(before);
    rmSync(dir, { recursive: true, force: true });
  });
});
