import { randomUUID } from 'node:crypto';
import { CoordinationEngine } from '../coordination/CoordinationEngine.js';
import type { ResourceRef, TaskProposal } from '../coordination/types.js';
import { TaskProposalSchema } from '../coordination/types.js';
import type { DecisionContext, LayaModelAdapter, LayaPlan, LayaRequest, PlanningPolicy } from './types.js';

export class LayaPlanningEngine {
  constructor(
    private readonly coordination: CoordinationEngine,
    private readonly adapter: LayaModelAdapter,
  ) {}

  async plan(context: DecisionContext, objective: string, parentTaskId?: string, policy?: Partial<PlanningPolicy>): Promise<{ plan: LayaPlan; submitted: ReturnType<CoordinationEngine['submitProposals']> }> {
    const planningPolicy: PlanningPolicy = {
      maxDepth: policy?.maxDepth ?? 3,
      maxTasksPerPlan: policy?.maxTasksPerPlan ?? 20,
      maxTotalTasks: policy?.maxTotalTasks ?? 100,
      maxDependencyEdges: policy?.maxDependencyEdges ?? 100,
      maxPlanRevisions: policy?.maxPlanRevisions ?? 10,
    };
    const resources: ResourceRef[] = context.coordination.localPlans.flatMap((plan) => plan.todos.flatMap((todo) => [...todo.readSet, ...todo.writeSet]));
    const request: LayaRequest = {
      missionId: context.mission.id,
      objective,
      parentTaskId,
      context: {
        missionGoal: context.mission.goal,
        constraints: context.mission.constraints,
        existingTasks: context.taskGraph.tasks,
        dependencies: context.taskGraph.dependencies,
        resources,
        acceptanceCriteria: context.mission.completionCriteria.map((item) => {
          if (typeof item === 'object' && item !== null && 'description' in item) return String((item as { description: unknown }).description);
          return String(item);
        }),
      },
      planningPolicy,
    };
    const raw = await this.adapter.generate(request);
    const plan = this.normalize(raw, context, planningPolicy);
    const submitted = this.coordination.submitProposals(context.mission.id, plan.tasks);
    return { plan, submitted };
  }

  private normalize(raw: LayaPlan, context: DecisionContext, policy: PlanningPolicy): LayaPlan {
    if (raw.tasks.length > policy.maxTasksPerPlan) throw new Error('Laya plan exceeds maxTasksPerPlan');
    if (raw.dependencies.length > policy.maxDependencyEdges) throw new Error('Laya plan exceeds maxDependencyEdges');
    const proposals: TaskProposal[] = raw.tasks.map((item, index) => TaskProposalSchema.parse({
      ...item,
      proposalId: item.proposalId || `laya_proposal_${randomUUID()}`,
      missionId: context.mission.id,
      agentId: item.agentId || 'laya',
      baseGraphVersion: context.taskGraph.version,
      idempotencyKey: item.idempotencyKey || `laya:${context.mission.id}:${raw.planId}:${index}:${item.title}`,
      createdAt: item.createdAt || new Date().toISOString(),
      dependencies: item.dependencies ?? [],
      readSet: item.readSet ?? [],
      writeSet: item.writeSet ?? [],
      requiredCapabilities: item.requiredCapabilities ?? [],
      acceptanceCriteria: item.acceptanceCriteria ?? [],
      orderingAfter: item.orderingAfter ?? [],
      metadata: { ...(item.metadata ?? {}), layaPlanId: raw.planId },
    }));
    const known = new Set(context.taskGraph.tasks.map((task) => task.id));
    for (const proposal of proposals) for (const dependency of proposal.dependencies) {
      if (!known.has(dependency) && !proposals.some((candidate) => candidate.globalTaskId === dependency)) throw new Error('Laya proposal references unknown dependency ' + dependency);
    }
    return { ...raw, tasks: proposals };
  }
}