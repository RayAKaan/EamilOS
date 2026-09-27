import type { DecisionContext, DecisionEvaluation, JevDecision } from './types.js';
import { JevDecisionSchema } from './types.js';

export class DecisionValidator {
  validate(decision: unknown, context: DecisionContext): DecisionEvaluation {
    const parsed = JevDecisionSchema.safeParse(decision);
    if (!parsed.success) {
      return { accepted: false, reasons: parsed.error.issues.map(i => i.message), stale: false };
    }

    const value = parsed.data as JevDecision;
    const reasons: string[] = [];

    if (value.missionId !== context.mission.id) reasons.push('Decision mission does not match context mission.');

    const taskIds = new Set(context.taskGraph.tasks.map(t => t.id));
    for (const target of value.targets) {
      if (target.taskId && !taskIds.has(target.taskId)) reasons.push(`Unknown target task: ${target.taskId}`);
    }

    if (value.assignments) {
      for (const assignment of value.assignments) {
        if (!taskIds.has(assignment.taskId)) reasons.push(`Unknown assignment task: ${assignment.taskId}`);
      }
    }

    if (value.action === 'COMPLETE') {
      const incomplete = context.taskGraph.tasks.filter(t => t.state !== 'COMPLETED');
      if (incomplete.length > 0) reasons.push('Mission cannot be completed while authoritative tasks remain incomplete.');
    }

    if (value.action === 'PARALLELIZE') {
      const targets = value.targets.flatMap(t => t.taskId ? [t.taskId] : []);
      if (targets.length > 1 && this.hasWriteConflict(targets, context)) {
        reasons.push('Parallelization conflicts with declared write resources.');
      }
    }

    const stale = value.contextVersion !== undefined && value.contextVersion !== context.taskGraph.version;
    if (stale) reasons.push('Decision was generated against a stale task graph version.');

    return { accepted: reasons.length === 0, decision: value, reasons, stale };
  }

  private hasWriteConflict(taskIds: string[], context: DecisionContext): boolean {
    const plans = context.coordination.localPlans;
    const writes = new Map<string, string>();
    for (const plan of plans) {
      for (const todo of plan.todos) {
        if (!taskIds.includes(todo.taskId)) continue;
        for (const resource of todo.writeSet) {
          const key = `${resource.kind}:${resource.id}:${resource.scope ?? ''}`;
          const previous = writes.get(key);
          if (previous && previous !== todo.taskId) return true;
          writes.set(key, todo.taskId);
        }
      }
    }
    return false;
  }
}
