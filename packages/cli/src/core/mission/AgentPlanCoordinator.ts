import { randomUUID } from 'crypto';
import { AgentPlanStore } from './AgentPlanStore.js';
import { PlanReconciler } from './PlanReconciler.js';
import type { AgentPlan, AgentPlanInput, PlanReconciliation } from './AgentPlan.js';

export interface PlanProposalResult {
  plan: AgentPlan;
  reconciliation: PlanReconciliation;
}

export class AgentPlanCoordinator {
  readonly store: AgentPlanStore;
  readonly reconciler = new PlanReconciler();

  constructor(store = new AgentPlanStore()) {
    this.store = store;
  }

  submit(input: AgentPlanInput): PlanProposalResult {
    const plan: AgentPlan = {
      id: `plan_${randomUUID()}`,
      missionId: input.missionId,
      taskId: input.taskId,
      agentId: input.agentId,
      revision: 1,
      objective: input.objective,
      todos: input.todos.map((todo, index) => ({
        ...todo,
        id: todo.id || `todo_${randomUUID()}`,
        order: todo.order ?? index,
      })),
      generatedAt: new Date().toISOString(),
      metadata: input.metadata ?? {},
    };

    this.store.save(plan);
    const siblingPlans = this.store.listForTask(input.taskId);
    const reconciliation = this.reconciler.reconcile(siblingPlans);
    return { plan, reconciliation };
  }
}
