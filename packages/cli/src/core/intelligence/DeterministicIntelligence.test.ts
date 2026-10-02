import { describe, expect, it } from 'vitest';
import { DeterministicAgentSelector } from './DeterministicAgentSelector.js';
import { DeterministicPlanner } from './DeterministicPlanner.js';
import { DeterministicRecoveryEngine } from './DeterministicRecoveryEngine.js';
import { DeterministicParallelizationEngine } from './DeterministicParallelizationEngine.js';
import { DeterministicStrategicEngine } from './DeterministicStrategicEngine.js';
import { DeterministicIntelligenceProvider } from './DeterministicIntelligenceProvider.js';
import type { DecisionContext } from './types.js';

function context(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    schemaVersion: '1.0',
    mission: {
      id: 'mission_test',
      goal: 'Build and validate the feature',
      status: 'active',
      constraints: { maxConcurrentTasks: 2, requireValidation: true, requireEvidence: true },
      completionCriteria: [],
      requirements: {},
      graphVersion: 4,
    },
    project: { workspace: { workingDir: '/tmp/project' }, relevantFiles: [] },
    agents: [
      { id: 'agent-a', harness: 'opencode', capabilities: ['backend', 'testing', 'debugging'], status: 'AVAILABLE', health: 'HEALTHY' },
      { id: 'agent-b', harness: 'claude-code', capabilities: ['frontend', 'testing'], status: 'AVAILABLE', health: 'HEALTHY' },
      { id: 'agent-c', harness: 'aider', capabilities: ['backend', 'testing', 'debugging'], status: 'AVAILABLE', health: 'HEALTHY' },
    ],
    taskGraph: {
      version: 4,
      tasks: [
        { id: 'task_a', title: 'Implement backend', state: 'READY', priority: 'HIGH', dependencies: [], requiredCapabilities: ['backend'], acceptanceCriteria: ['backend works'], attempt: 0 },
        { id: 'task_b', title: 'Implement frontend', state: 'READY', priority: 'MEDIUM', dependencies: [], requiredCapabilities: ['frontend'], acceptanceCriteria: ['frontend works'], attempt: 0 },
      ],
      dependencies: [],
      readyTasks: ['task_a', 'task_b'],
      runningTasks: [],
      blockedTasks: [],
      completedTasks: [],
      failedTasks: [],
    },
    coordination: { conflicts: [], activeReservations: [], activeLeases: [], localPlans: [] },
    executions: [],
    failures: [],
    checkpoints: [],
    evidence: [],
    artifacts: { files: [], diffs: [], evidence: [] },
    decisions: [],
    progress: { totalTasks: 2, completedTasks: 0, runningTasks: 0, blockedTasks: 0, failedTasks: 0, readyTasks: 2, completionRatio: 0, progressSinceLastDecision: false },
    timestamp: '2026-10-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('Phase 2B deterministic intelligence', () => {
  it('selects a healthy agent deterministically by capability and id tie-break', () => {
    const selection = new DeterministicAgentSelector().select(context(), { requiredCapabilities: ['testing'], priority: 'MEDIUM' });
    expect(selection.agentId).toBe('agent-a');
    expect(selection.score).toBe(100);
  });

  it('produces a stable bounded plan without a model', () => {
    const planner = new DeterministicPlanner();
    const first = planner.plan(context(), 'Prepare\n- Implement API\n- Add tests');
    const second = planner.plan(context(), 'Prepare\n- Implement API\n- Add tests');
    expect(first.planId).toBe(second.planId);
    expect(first.tasks).toHaveLength(2);
    expect(first.tasks[1].dependencies).toEqual([first.tasks[0].globalTaskId]);
    expect(first.tasks.every(task => task.metadata?.deterministic === true)).toBe(true);
  });

  it('recovers a validation failure with bounded retry before replanning', () => {
    const decision = new DeterministicRecoveryEngine().decide(context({
      failures: [{
        id: 'failure_1', type: 'VALIDATION_FAILED', taskId: 'task_a', recoverable: true,
        details: 'test failed', timestamp: '2026-10-02T00:01:00.000Z',
      }],
    }), 'VALIDATION_FAILED');
    expect(decision.action).toBe('RETRY');
    expect(decision.targets[0]?.taskId).toBe('task_a');
  });

  it('reassigns after retry budget is exhausted when a compatible agent exists', () => {
    const decision = new DeterministicRecoveryEngine().decide(context({
      taskGraph: {
        ...context().taskGraph,
        tasks: [{ ...context().taskGraph.tasks[0], attempt: 3, maxAttempts: 3 }],
        readyTasks: [], failedTasks: ['task_a'], blockedTasks: [],
      },
      failures: [{
        id: 'failure_2', type: 'WORKER_LOST', taskId: 'task_a', workerId: 'agent-a',
        recoverable: true, details: 'worker disappeared', timestamp: '2026-10-02T00:02:00.000Z',
      }],
    }), 'WORKER_LOST');
    expect(decision.action).toBe('REASSIGN');
    expect(decision.assignments?.[0]?.agentId).toBe('agent-c');
  });

  it('parallelizes independent ready work within capacity', () => {
    const decision = new DeterministicParallelizationEngine().decide(context());
    expect(decision.action).toBe('PARALLELIZE');
    expect(decision.targets.map(target => target.taskId)).toEqual(['task_a', 'task_b']);
  });

  it('chooses verification when every authoritative task is complete', () => {
    const base = context();
    const decision = new DeterministicStrategicEngine().decide(context({
      taskGraph: { ...base.taskGraph, readyTasks: [], completedTasks: ['task_a', 'task_b'], tasks: base.taskGraph.tasks.map(task => ({ ...task, state: 'COMPLETED' })) },
      progress: { ...base.progress, completedTasks: 2, readyTasks: 0, completionRatio: 1, progressSinceLastDecision: true },
    }), 'MISSION_NEAR_COMPLETION');
    expect(decision.action).toBe('VERIFY');
  });

  it('is always healthy and model-independent', async () => {
    const provider = new DeterministicIntelligenceProvider();
    expect((await provider.health()).status).toBe('READY');
    const result = await provider.evaluate({
      requestId: 'request_1',
      missionId: 'mission_test',
      type: 'PARALLELIZATION',
      priority: 'NORMAL',
      contextVersion: 4,
      contextHash: 'hash',
      context: context(),
    });
    expect(result.status).toBe('SUCCESS');
    expect((result.result as { action: string }).action).toBe('PARALLELIZE');
  });
});
