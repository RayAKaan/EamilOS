import type { DecisionContextBuilder } from './DecisionContextBuilder.js';
import type { DecisionRuntime } from './DecisionRuntime.js';
import { DecisionStore } from './DecisionStore.js';
import type { DecisionTrigger, IntelligenceConfig, StrategicLoopState } from './types.js';
import type { DecisionApplier, AppliedDecision } from './DecisionApplier.js';

export interface StrategicLoopResult {
  status: 'COMPLETED' | 'BLOCKED' | 'ESCALATED' | 'ABORTED' | 'BUDGET_EXHAUSTED' | 'STAGNATED';
  iterations: number;
  decisions: number;
  replans: number;
  messages: string[];
}

export class StrategicLoop {
  constructor(
    private readonly contextBuilder: DecisionContextBuilder,
    private readonly runtime: DecisionRuntime,
    private readonly applier: DecisionApplier,
    private readonly store: DecisionStore,
    private readonly config: IntelligenceConfig,
  ) {}

  async run(missionId: string, trigger: DecisionTrigger = 'USER_REQUESTED'): Promise<StrategicLoopResult> {
    const loop: StrategicLoopState = this.store.getLoop(missionId);
    const messages: string[] = [];
    let currentTrigger = trigger;
    for (; loop.iterations < this.config.loop.maxIterations; loop.iterations += 1) {
      const context = this.contextBuilder.build(missionId);
      if (context.mission.status === 'completed') return this.result('COMPLETED', loop, messages);
      if (context.mission.status === 'cancelled') return this.result('ABORTED', loop, messages);
      if (context.progress.blockedTasks > 0 && context.progress.runningTasks === 0 && context.progress.readyTasks === 0) return this.result('BLOCKED', loop, messages);
      if (loop.consecutiveNoProgress >= this.config.loop.stagnationThreshold) return this.result('STAGNATED', loop, messages);
      if (this.config.budgets.jev.maxDecisions !== undefined && loop.decisions >= this.config.budgets.jev.maxDecisions) return this.result('BUDGET_EXHAUSTED', loop, messages);

      const { evaluation, record } = await this.runtime.evaluate(context, currentTrigger);
      this.store.saveDecision(record);
      loop.decisions += 1;
      if (!evaluation.accepted || !evaluation.decision) {
        messages.push('Decision rejected: ' + evaluation.reasons.join('; '));
        loop.consecutiveNoProgress += 1;
        currentTrigger = 'PLAN_REJECTED';
        this.store.updateLoop(missionId, loop);
        continue;
      }
      const action = evaluation.decision.action;
      if (action === 'REPLAN' || action === 'DECOMPOSE' || action === 'SEQUENCE') {
        loop.replans += 1;
        if (loop.replans > this.config.loop.maxReplans) return this.result('BUDGET_EXHAUSTED', loop, messages);
      }
      if (action !== 'ABORT' && !this.config.policies.allowAutonomousExecution && ['EXECUTE', 'CONTINUE', 'RETRY', 'REASSIGN', 'PARALLELIZE'].includes(action)) {
        messages.push('Execution decision withheld by intelligence policy.');
        loop.consecutiveNoProgress += 1;
        currentTrigger = 'USER_REQUESTED';
        this.store.updateLoop(missionId, loop);
        continue;
      }
      try {
        const applied = await this.applier.apply(context, evaluation.decision);
        record.status = applied.changed ? 'PARTIALLY_APPLIED' : 'ACCEPTED';
        record.appliedActions = applied.messages;
        this.store.saveDecision(record);
        messages.push(...applied.messages);
        loop.consecutiveNoProgress = applied.progress ? 0 : loop.consecutiveNoProgress + 1;
        const after = this.contextBuilder.build(missionId);
        if (after.mission.status === 'completed') return this.result('COMPLETED', loop, messages);
        if (after.mission.status === 'cancelled') return this.result('ABORTED', loop, messages);
        currentTrigger = this.nextTrigger(applied, after);
      } catch (error) {
        record.status = 'FAILED';
        record.rejectionReason = error instanceof Error ? error.message : String(error);
        this.store.saveDecision(record);
        messages.push(error instanceof Error ? error.message : String(error));
        loop.consecutiveNoProgress += 1;
        currentTrigger = 'EXECUTION_FAILED';
      }
      this.store.updateLoop(missionId, loop);
    }
    return this.result('BUDGET_EXHAUSTED', loop, messages);
  }

  private nextTrigger(applied: AppliedDecision, context: ReturnType<DecisionContextBuilder['build']>): DecisionTrigger {
    if (context.progress.totalTasks > 0 && context.progress.completedTasks === context.progress.totalTasks) return 'MISSION_NEAR_COMPLETION';
    if (!applied.progress && context.progress.blockedTasks > 0) return 'MISSION_BLOCKED';
    if (!applied.progress && context.progress.failedTasks > 0) return 'TASK_FAILED';
    if (applied.action === 'VERIFY') return 'VALIDATION_FAILED';
    if (applied.action === 'ABORT') return 'USER_REQUESTED';
    return 'PERIODIC_REVIEW';
  }

  private result(status: StrategicLoopResult['status'], loop: StrategicLoopState, messages: string[]): StrategicLoopResult {
    return { status, iterations: loop.iterations, decisions: loop.decisions, replans: loop.replans, messages };
  }
}