import type { CoordinationEngine } from '../coordination/CoordinationEngine.js';
import type { MissionEngine } from '../mission/MissionEngine.js';
import type { HarnessScheduler, ScheduleExecutionResult } from '../execution/HarnessScheduler.js';
import { ExecutionStore } from '../execution/ExecutionStore.js';
import type { DecisionContext, JevDecision, LayaModelAdapter, PlanningPolicy } from './types.js';
import { LayaPlanningEngine } from './LayaPlanningEngine.js';

export interface AppliedDecision {
  action: JevDecision['action'];
  changed: boolean;
  progress: boolean;
  messages: string[];
  executions: ScheduleExecutionResult[];
  planId?: string;
}

export class DecisionApplier {
  private readonly planner: LayaPlanningEngine;
  constructor(
    private readonly missions: MissionEngine,
    private readonly coordination: CoordinationEngine,
    private readonly scheduler: HarnessScheduler,
    laya: LayaModelAdapter,
    private readonly executionStore: ExecutionStore = new ExecutionStore(),
  ) { this.planner = new LayaPlanningEngine(coordination, laya); }

  async apply(context: DecisionContext, decision: JevDecision): Promise<AppliedDecision> {
    switch (decision.action) {
      case 'DECOMPOSE':
      case 'REPLAN':
      case 'SEQUENCE': return this.plan(context, decision);
      case 'EXECUTE':
      case 'CONTINUE':
      case 'RETRY':
      case 'REASSIGN': return this.execute(context, decision);
      case 'PARALLELIZE': return this.parallelize(context, decision);
      case 'VERIFY': return this.verify(context, decision);
      case 'COMPLETE': return this.complete(context);
      case 'ESCALATE': return this.escalate(context, decision);
      case 'ABORT':
        this.missions.cancel(context.mission.id);
        return { action: decision.action, changed: true, progress: false, messages: ['Mission cancellation requested by validated decision.'], executions: [] };
    }
  }

  private async plan(context: DecisionContext, decision: JevDecision): Promise<AppliedDecision> {
    const target = decision.targets.find((item) => item.taskId)?.taskId;
    const task = target ? context.taskGraph.tasks.find((item) => item.id === target) : undefined;
    const result = await this.planner.plan(context, task?.title ?? context.mission.goal, target, decision.recovery as PlanningPolicy | undefined);
    return { action: decision.action, changed: result.submitted.accepted.length > 0, progress: result.submitted.accepted.length > 0, messages: ['Laya submitted ' + result.submitted.accepted.length + ' authoritative proposal(s).'], executions: [], planId: result.plan.planId };
  }

  private async execute(context: DecisionContext, decision: JevDecision): Promise<AppliedDecision> {
    const ids = this.targetTaskIds(context, decision).slice(0, 1);
    const executions: ScheduleExecutionResult[] = [];
    for (const taskId of ids) {
      const target = decision.targets.find((item) => item.taskId === taskId);
      executions.push(await this.scheduler.execute(context.mission.id, taskId, { preferredHarnessId: target?.harnessId }));
    }
    return { action: decision.action, changed: executions.length > 0, progress: executions.some((item) => item.finalResult.status === 'COMPLETED'), messages: executions.map((item) => 'Task ' + item.finalResult.taskId + ': ' + item.finalResult.status), executions };
  }

  private async parallelize(context: DecisionContext, decision: JevDecision): Promise<AppliedDecision> {
    const ids = this.targetTaskIds(context, decision).slice(0, 8);
    const results = await Promise.all(ids.map((taskId) => this.scheduler.execute(context.mission.id, taskId)));
    return { action: decision.action, changed: results.length > 0, progress: results.some((item) => item.finalResult.status === 'COMPLETED'), messages: results.map((item) => 'Parallel task ' + item.finalResult.taskId + ': ' + item.finalResult.status), executions: results };
  }

  private verify(context: DecisionContext, decision: JevDecision): AppliedDecision {
    const ids = this.targetTaskIds(context, decision);
    const messages: string[] = [];
    let progress = false;
    for (const taskId of ids) {
      const execution = this.executionStore.getLatestExecutionForTask(context.mission.id, taskId);
      if (!execution) { messages.push('No execution record for ' + taskId + '.'); continue; }
      const passed = execution.result?.validation?.passed === true;
      const validationNotRequired = !context.mission.constraints.requireValidation;
      if (passed || (validationNotRequired && execution.state === 'VALIDATING')) {
        this.missions.recordEvidence(context.mission.id, { id: 'evidence_' + taskId + '_' + Date.now(), type: 'validation', description: passed ? 'Harness validation passed.' : 'Validation was not required by mission policy.', reference: execution.executionId, passed: true, metadata: { harnessId: execution.harnessId } });
        this.missions.transitionTask(context.mission.id, taskId, 'COMPLETED');
        progress = true;
        messages.push('Verified ' + taskId + '.');
      } else {
        messages.push('Validation did not pass for ' + taskId + '.');
      }
    }
    return { action: decision.action, changed: progress, progress, messages, executions: [] };
  }

  private complete(context: DecisionContext): AppliedDecision {
    const result = this.missions.evaluateCompletion(context.mission.id);
    return { action: 'COMPLETE', changed: result.complete, progress: result.complete, messages: result.complete ? ['Mission completed.'] : result.reasons, executions: [] };
  }

  private escalate(context: DecisionContext, decision: JevDecision): AppliedDecision {
    const ids = this.targetTaskIds(context, decision);
    for (const taskId of ids) this.missions.transitionTask(context.mission.id, taskId, 'ESCALATED');
    return { action: decision.action, changed: ids.length > 0, progress: false, messages: ids.length > 0 ? ['Escalated ' + ids.length + ' task(s).'] : ['Strategic escalation recorded.'], executions: [] };
  }

  private targetTaskIds(context: DecisionContext, decision: JevDecision): string[] {
    const requested = decision.targets.flatMap((target) => target.taskId ? [target.taskId] : []);
    return requested.length > 0 ? requested : context.taskGraph.readyTasks.slice(0, 1);
  }
}