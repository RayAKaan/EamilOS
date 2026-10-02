import { describe, expect, it } from 'vitest';
import { DecisionFusionEngine } from './DecisionFusionEngine.js';
import type { DecisionContext, JevDecision } from './types.js';
import type { FusionCandidate } from './DecisionFusionTypes.js';

const baseContext = (): DecisionContext => ({
  schemaVersion: '1.0',
  mission: { id: 'm1', goal: 'ship', status: 'active', constraints: {}, completionCriteria: [], requirements: {}, graphVersion: 1 },
  project: { workspace: { workingDir: '/tmp' }, relevantFiles: [] },
  agents: [{ id: 'a1', harness: 'test', capabilities: ['code'], status: 'AVAILABLE', health: 'HEALTHY' }],
  taskGraph: { version: 1, tasks: [{ id: 't1', title: 'ship', state: 'READY', priority: 'HIGH', dependencies: [], requiredCapabilities: ['code'], acceptanceCriteria: [], attempt: 0 }], dependencies: [], readyTasks: ['t1'], runningTasks: [], blockedTasks: [], completedTasks: [], failedTasks: [] },
  coordination: { conflicts: [], activeReservations: [], activeLeases: [], localPlans: [] },
  executions: [], failures: [], checkpoints: [], evidence: [], artifacts: { files: [], diffs: [], evidence: [] }, decisions: [],
  progress: { totalTasks: 1, completedTasks: 0, runningTasks: 0, blockedTasks: 0, failedTasks: 0, readyTasks: 1, completionRatio: 0, progressSinceLastDecision: false },
  timestamp: new Date().toISOString(),
});

const decision = (action: JevDecision['action'], confidence: number): JevDecision => ({
  decisionId: action + '-d', missionId: 'm1', action, reasoning: '', targets: [{ taskId: 't1' }], confidence, contextVersion: 1,
});

describe('DecisionFusionEngine', () => {
  it('fuses agreement across deterministic and Jev', () => {
    const result = new DecisionFusionEngine().fuse(baseContext(), [
      { source: 'deterministic', decision: decision('EXECUTE', 0.9), confidence: 0.9 },
      { source: 'jev', decision: decision('EXECUTE', 0.8), confidence: 0.8 },
    ]);
    expect(result.accepted).toBe(true);
    expect(result.decision?.action).toBe('EXECUTE');
    expect(result.decision?.fusion.disagreement).toBe(false);
  });
  it('abstains on strong disagreement with low confidence', () => {
    const result = new DecisionFusionEngine().fuse(baseContext(), [
      { source: 'deterministic', decision: decision('EXECUTE', 0.5), confidence: 0.5 },
      { source: 'jev', decision: decision('REPLAN', 0.5), confidence: 0.5 },
    ]);
    expect(result.abstained).toBe(true);
    expect(result.humanReviewRequired).toBe(true);
  });
  it('uses historical outcome influence without overriding constraints', () => {
    const result = new DecisionFusionEngine().fuse(baseContext(), [
      { source: 'deterministic', decision: decision('EXECUTE', 0.7), confidence: 0.7 },
      { source: 'jev', decision: decision('REPLAN', 0.8), confidence: 0.8 },
    ], [
      { source: 'jev', action: 'REPLAN', success: false, timestamp: new Date().toISOString() },
      { source: 'deterministic', action: 'EXECUTE', success: true, timestamp: new Date().toISOString() },
    ]);
    expect(result.decision?.action).toBe('EXECUTE');
  });
  it('forces review for configured high-risk actions', () => {
    const result = new DecisionFusionEngine(undefined, { deterministicWeight: 1, jevWeight: .85, layaWeight: .65, agreementBonus: .15, disagreementPenalty: .1, historicalInfluence: .2, minimumConfidence: .4, humanReviewThreshold: .99, requireHumanReviewFor: ['ABORT'] }).fuse(baseContext(), [
      { source: 'deterministic', decision: decision('ABORT', .95), confidence: .95 },
    ]);
    expect(result.decision?.action).toBe('ABORT');
    expect(result.humanReviewRequired).toBe(true);
  });
});
