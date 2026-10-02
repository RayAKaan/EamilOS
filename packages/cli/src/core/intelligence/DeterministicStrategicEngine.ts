import type { DecisionContext, DecisionTrigger, JevDecision } from './types.js';
import { DeterministicParallelizationEngine } from './DeterministicParallelizationEngine.js';
import { DeterministicRecoveryEngine } from './DeterministicRecoveryEngine.js';
import { DeterministicAgentSelector } from './DeterministicAgentSelector.js';

export class DeterministicStrategicEngine {
  constructor(
    private readonly recovery = new DeterministicRecoveryEngine(),
    private readonly parallelization = new DeterministicParallelizationEngine(),
    private readonly selector = new DeterministicAgentSelector(),
  ) {}

  decide(context: DecisionContext, trigger: DecisionTrigger): JevDecision {
    const completion = context.progress.totalTasks > 0 && context.progress.completedTasks === context.progress.totalTasks;
    if (completion) {
      return this.decision(context, 'VERIFY', 'All authoritative tasks are completed; deterministic verification is the next gate.', context.taskGraph.completedTasks);
    }

    if (context.mission.status === 'cancelled') {
      return this.decision(context, 'ABORT', 'Mission is already cancelled; no further execution is permitted.', []);
    }

    if (context.failures.length > 0 || context.taskGraph.failedTasks.length > 0) {
      return this.recovery.decide(context, trigger);
    }

    const maxConcurrentTasks = Number(context.mission.constraints.maxConcurrentTasks ?? 1);
    if (context.taskGraph.readyTasks.length >= 2 && maxConcurrentTasks > 1) {
      return this.parallelization.decide(context);
    }

    if (context.taskGraph.readyTasks.length === 1) {
      const taskId = context.taskGraph.readyTasks[0];
      const task = context.taskGraph.tasks.find(item => item.id === taskId);
      const selected = this.selector.select(context, task);
      return {
        ...this.decision(context, 'EXECUTE', 'Exactly one ready task is available and can be deterministically routed.', [taskId]),
        targets: [{ taskId, agentId: selected.agentId, harnessId: selected.harnessId }],
        assignments: selected.agentId ? [{ taskId, agentId: selected.agentId, harnessId: selected.harnessId, priority: this.priority(task?.priority ?? 'MEDIUM') }] : undefined,
      };
    }

    if (context.taskGraph.blockedTasks.length > 0) {
      const blocked = context.taskGraph.tasks.filter(task => context.taskGraph.blockedTasks.includes(task.id));
      const dependency = blocked.flatMap(task => task.dependencies).find(dep => context.taskGraph.readyTasks.includes(dep));
      if (dependency) return this.decision(context, 'EXECUTE', 'A blocked task has a dependency that is ready; execute the dependency first.', [dependency]);
      return this.decision(context, 'REPLAN', 'Blocked work has no ready dependency; deterministic replanning is required.', blocked.map(task => task.id));
    }

    if (context.progress.totalTasks === 0) {
      return this.decision(context, 'DECOMPOSE', 'The mission has no authoritative tasks; create a bounded deterministic plan from the mission goal.', []);
    }

    if (context.progress.progressSinceLastDecision) {
      return this.decision(context, 'CONTINUE', 'Mission state has advanced since the previous decision; continue observing before changing strategy.', []);
    }

    return this.decision(context, 'ESCALATE', `No deterministic transition is safe for trigger ${trigger}; request higher-level intelligence or human intervention.`, [], 0.8);
  }

  private decision(context: DecisionContext, action: JevDecision['action'], reasoning: string, taskIds: string[], confidence = 0.99): JevDecision {
    return {
      decisionId: `det-strategy-${context.mission.id}-${context.taskGraph.version}-${action.toLowerCase()}`,
      missionId: context.mission.id,
      action,
      reasoning,
      targets: taskIds.map(taskId => ({ taskId })),
      confidence,
      expectedOutcome: reasoning,
      contextVersion: context.taskGraph.version,
    };
  }

  private priority(priority: string): number {
    return priority === 'CRITICAL' ? 100 : priority === 'HIGH' ? 75 : priority === 'MEDIUM' ? 50 : 25;
  }
}
