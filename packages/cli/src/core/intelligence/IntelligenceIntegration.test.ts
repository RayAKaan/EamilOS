import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MissionStore } from '../mission/MissionStore.js';
import { CoordinationStore } from '../coordination/CoordinationStore.js';
import { MissionEngine } from '../mission/MissionEngine.js';
import { CoordinationEngine } from '../coordination/CoordinationEngine.js';
import { LayaPlanningEngine } from './LayaPlanningEngine.js';
import { MockLayaAdapter } from './providers/MockLayaAdapter.js';
import { DecisionValidator } from './DecisionValidator.js';
import type { DecisionContext } from './types.js';

function contextFor(missionId: string, version = 0): DecisionContext {
  return {
    schemaVersion: '1.0',
    project: { workspace: { workingDir: process.cwd() }, relevantFiles: [] },
    agents: [],
    mission: { id: missionId, goal: 'Build feature', status: 'active', constraints: {}, completionCriteria: [], requirements: {}, graphVersion: version },
    taskGraph: { version, tasks: [], dependencies: [], readyTasks: [], runningTasks: [], blockedTasks: [], completedTasks: [], failedTasks: [] },
    coordination: { conflicts: [], activeReservations: [], activeLeases: [], localPlans: [] },
    executions: [], failures: [], checkpoints: [], evidence: [], artifacts: { files: [], diffs: [], evidence: [] }, decisions: [],
    progress: { totalTasks: 0, completedTasks: 0, runningTasks: 0, blockedTasks: 0, failedTasks: 0, readyTasks: 0, completionRatio: 0, progressSinceLastDecision: true },
    timestamp: new Date().toISOString(),
  };
}

describe('Phase 3 intelligence', () => {
  it('materializes a Laya plan through the authoritative coordination engine', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eamilos-phase3-'));
    const missions = new MissionEngine(new MissionStore(join(root, 'missions')));
    const mission = missions.createMission({ goal: 'Build feature', workingDir: process.cwd() });
    missions.start(mission.id);
    const coordination = new CoordinationEngine(missions, new CoordinationStore(join(root, 'coordination')));
    const planner = new LayaPlanningEngine(coordination, new MockLayaAdapter());

    const result = await planner.plan(contextFor(mission.id), 'Implement the feature');
    expect(result.submitted.accepted).toHaveLength(1);
    expect(missions.snapshot(mission.id).tasks).toHaveLength(1);
    expect(missions.snapshot(mission.id).tasks[0].title).toBe('Implement the feature');
  });

  it('rejects stale Jev decisions before orchestration', () => {
    const context = contextFor('mission-1', 4);
    const result = new DecisionValidator().validate({
      decisionId: 'decision-1',
      missionId: 'mission-1',
      action: 'CONTINUE',
      targets: [],
      contextVersion: 3,
    }, context);
    expect(result.accepted).toBe(false);
    expect(result.stale).toBe(true);
  });
});
