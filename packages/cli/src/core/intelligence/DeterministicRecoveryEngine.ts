import type { DecisionContext, FailureContext, JevDecision, DecisionTrigger } from './types.js';
import { DeterministicAgentSelector } from './DeterministicAgentSelector.js';

export class DeterministicRecoveryEngine {
  constructor(private readonly selector = new DeterministicAgentSelector()) {}

  decide(context: DecisionContext, trigger: DecisionTrigger = 'EXECUTION_FAILED'): JevDecision {
    const failure = this.latestFailure(context);
    const task = failure?.taskId
      ? context.taskGraph.tasks.find(item => item.id === failure.taskId)
      : context.taskGraph.tasks.find(item => item.state === 'RECOVERABLE' || item.state === 'FAILED');

    if (!task) {
      return this.decision(context, trigger, 'CONTINUE', [], 'No failed/recoverable task exists; continue with ready work.', 0.99);
    }

    const attempts = task.attempt;
    const candidates = context.agents.filter(agent =>
      agent.id !== failure?.workerId &&
      (agent.status === 'AVAILABLE' || agent.health === 'HEALTHY' || agent.health === 'healthy'),
    );
    const alternative = candidates.find(agent =>
      task.requiredCapabilities.every(capability => agent.capabilities.includes(capability)),
    );

    if (failure?.type === 'PERMISSION_DENIED') {
      return this.decision(context, trigger, 'ESCALATE', [task.id], 'Permission denial requires an explicit human authorization path.', 0.99);
    }

    if (failure?.type === 'RESOURCE_CONFLICT') {
      return this.decision(context, trigger, 'SEQUENCE', [task.id], 'Resource contention must be serialized before execution resumes.', 0.98);
    }

    if (failure?.type === 'AUTH_REQUIRED' || failure?.type === 'AUTH_FAILED') {
      return this.decision(context, trigger, 'ESCALATE', [task.id], 'Authentication cannot be safely inferred or bypassed by deterministic recovery.', 0.99);
    }

    const retryable = new Set(['TIMEOUT', 'CRASH', 'INVALID_OUTPUT', 'VALIDATION_FAILED', 'RATE_LIMIT', 'CONTEXT_LIMIT', 'WORKER_UNAVAILABLE', 'WORKER_LOST', 'UNKNOWN']);
    if (retryable.has(failure?.type ?? 'UNKNOWN') && attempts < task.maxAttempts) {
      return this.decision(context, trigger, 'RETRY', [task.id], `Retry is allowed: attempt ${attempts} is below maxAttempts ${task.maxAttempts}.`, 0.96);
    }

    if (alternative) {
      const selected = this.selector.select(context, task);
      const target = selected.agentId === alternative.id ? selected : {
        agentId: alternative.id,
        harnessId: alternative.harness,
        score: 100,
        reasons: ['alternative healthy agent satisfies every required capability'],
      };
      return {
        ...this.decision(context, trigger, 'REASSIGN', [task.id], 'Retry budget is exhausted or the worker is unsuitable; a compatible alternative exists.', 0.94),
        targets: [{ taskId: task.id, agentId: target.agentId, harnessId: target.harnessId }],
        assignments: [{ taskId: task.id, agentId: target.agentId, harnessId: target.harnessId, priority: this.priority(task.priority) }],
      };
    }

    return this.decision(context, trigger, 'REPLAN', [task.id], 'No deterministic recovery path is feasible with the current fleet.', 0.93);
  }

  private latestFailure(context: DecisionContext): FailureContext | undefined {
    return [...context.failures].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  }

  private decision(context: DecisionContext, trigger: DecisionTrigger, action: JevDecision['action'], taskIds: string[], reasoning: string, confidence: number): JevDecision {
    return {
      decisionId: `det-recovery-${context.mission.id}-${context.taskGraph.version}-${action.toLowerCase()}`,
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
