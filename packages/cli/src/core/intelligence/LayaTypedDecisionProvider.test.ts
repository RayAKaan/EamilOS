import { describe, expect, it } from 'vitest';
import { LayaCalibration } from './LayaCalibration.js';
import { LayaQuestionBuilder } from './LayaQuestionBuilder.js';
import { LayaTypedDecisionProvider } from './LayaTypedDecisionProvider.js';
import type { LayaDecisionAdapter } from './LayaDecisionTypes.js';
import type { DecisionContext } from './types.js';

const context = (): DecisionContext => ({
  schemaVersion: '1.0',
  mission: { id: 'mission_laya', goal: 'Ship feature', status: 'active', constraints: { maxConcurrentTasks: 2 }, completionCriteria: ['tests pass'], requirements: {}, graphVersion: 3 },
  project: { workspace: { workingDir: '/tmp/project' }, relevantFiles: [] },
  agents: [
    { id: 'agent-a', harness: 'opencode', capabilities: ['backend'], status: 'AVAILABLE', health: 'HEALTHY' },
    { id: 'agent-b', harness: 'claude-code', capabilities: ['frontend'], status: 'AVAILABLE', health: 'HEALTHY' },
  ],
  taskGraph: { version: 3, tasks: [{ id: 'task-a', title: 'Implement API', state: 'READY', priority: 'HIGH', dependencies: [], requiredCapabilities: ['backend'], acceptanceCriteria: ['API works'], attempt: 0 }], dependencies: [], readyTasks: ['task-a'], runningTasks: [], blockedTasks: [], completedTasks: [], failedTasks: [] },
  coordination: { conflicts: [], activeReservations: [], activeLeases: [], localPlans: [] },
  executions: [], failures: [], checkpoints: [], evidence: [], artifacts: { files: [], diffs: [], evidence: [] }, decisions: [],
  progress: { totalTasks: 1, completedTasks: 0, runningTasks: 0, blockedTasks: 0, failedTasks: 0, readyTasks: 1, completionRatio: 0, progressSinceLastDecision: false }, timestamp: new Date().toISOString(),
});
class FakeAdapter implements LayaDecisionAdapter {
  id = 'laya-http';
  async predict() { return { model: 'typed-decisions', answers: { action: { type: 'choice' as const, choice: 'EXECUTE', probabilities: { EXECUTE: 0.9, RETRY: 0.05, ESCALATE: 0.05 }, confidence: 0.8 } } }; }
  async health() { return { healthy: true }; }
}
describe('Laya typed decisions', () => {
  it('builds constrained questions', () => {
    const result = new LayaQuestionBuilder().build({ requestId: 'r1', missionId: 'mission_laya', type: 'TASK_DECISION', priority: 'NORMAL', contextVersion: 3, contextHash: 'hash', context: context() }, context());
    expect(result.questionIds).toEqual(['action']); expect(result.request.questions.action.type).toBe('choice');
  });
  it('accepts a high-confidence typed decision', async () => {
    const result = await new LayaTypedDecisionProvider(new FakeAdapter()).evaluate({ requestId: 'r2', missionId: 'mission_laya', type: 'TASK_DECISION', priority: 'NORMAL', contextVersion: 3, contextHash: 'hash', context: context() });
    expect(result.status).toBe('SUCCESS'); expect(result.result?.decisions[0].answer.choice).toBe('EXECUTE');
  });
  it('degrades low-confidence decisions', () => {
    const calibration = new LayaCalibration({ enabled: false, choiceTemperature: 1, scoreTemperature: 1, noulTemperature: 1, minimumConfidence: 0.9, minimumProbability: 0.9 });
    expect(calibration.apply('action', { type: 'choice', choice: 'EXECUTE', probabilities: { EXECUTE: 0.6, RETRY: 0.4 }, confidence: 0.2 }).accepted).toBe(false);
  });
  it('preserves noul probability as a signal', () => { expect(new LayaCalibration(DEFAULT_LAYA_CALIBRATION).apply('safe', { type: 'noul', noul: 0.82 }).answer.noul).toBeCloseTo(0.82); });
});
