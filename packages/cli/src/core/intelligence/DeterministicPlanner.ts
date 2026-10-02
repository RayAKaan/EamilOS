import { createHash } from 'node:crypto';
import type { TaskProposal } from '../coordination/types.js';
import type { DecisionContext, LayaPlan, PlanningPolicy } from './types.js';
import { DeterministicAgentSelector } from './DeterministicAgentSelector.js';

export class DeterministicPlanner {
  constructor(private readonly selector = new DeterministicAgentSelector()) {}

  plan(context: DecisionContext, objective: string, parentTaskId?: string, policy: Partial<PlanningPolicy> = {}): LayaPlan {
    const limits = {
      maxDepth: policy.maxDepth ?? 3,
      maxTasksPerPlan: policy.maxTasksPerPlan ?? 20,
      maxTotalTasks: policy.maxTotalTasks ?? 100,
      maxDependencyEdges: policy.maxDependencyEdges ?? 100,
      maxPlanRevisions: policy.maxPlanRevisions ?? 10,
    };

    if (context.taskGraph.tasks.length >= limits.maxTotalTasks) {
      throw new Error('Deterministic planner cannot add tasks: maxTotalTasks reached.');
    }

    const units = this.decompose(objective, context, parentTaskId).slice(0, limits.maxTasksPerPlan);
    const base = `det:${context.mission.id}:${context.taskGraph.version}:${objective}`;
    const planId = 'det-plan-' + createHash('sha256').update(base).digest('hex').slice(0, 16);
    const now = new Date().toISOString();

    const tasks: TaskProposal[] = [];
    let previousGlobalTaskId: string | undefined;
    for (const [index, unit] of units.entries()) {
      const requiredCapabilities = this.selector.inferCapabilities(unit.title + ' ' + unit.objective);
      const selected = this.selector.select(context, { requiredCapabilities, priority: unit.priority });
      const idBase = createHash('sha256').update(planId + ':' + index + ':' + unit.title).digest('hex').slice(0, 16);
      const globalTaskId = 'det-task-' + idBase;
      const task: TaskProposal = {
        proposalId: 'det-proposal-' + idBase,
        missionId: context.mission.id,
        agentId: selected.agentId ?? 'eamilos-deterministic',
        baseGraphVersion: context.taskGraph.version,
        globalTaskId,
        parentTaskId,
        title: unit.title,
        objective: unit.objective,
        dependencies: index === 0 ? (parentTaskId ? [parentTaskId] : []) : [previousGlobalTaskId!],
        priority: unit.priority,
        requiredCapabilities,
        acceptanceCriteria: unit.acceptanceCriteria,
        readSet: [],
        writeSet: [],
        idempotencyKey: 'det:' + context.mission.id + ':' + globalTaskId,
        orderingAfter: [],
        createdAt: now,
        metadata: { planner: 'deterministic', planId, deterministic: true },
      };
      tasks.push(task);
      previousGlobalTaskId = globalTaskId;
    }

    if (tasks.length > limits.maxDependencyEdges + 1) {
      throw new Error('Deterministic planner exceeds maxDependencyEdges.');
    }

    return {
      planId,
      missionId: context.mission.id,
      parentTaskId,
      objective,
      tasks,
      dependencies: tasks.slice(1).map((task, index) => ({
        fromProposalId: tasks[index].proposalId,
        toProposalId: task.proposalId,
      })),
      assumptions: ['Decomposition is structural and deterministic; no semantic model was used.'],
      risks: ['A free-form objective without explicit steps is represented as one bounded execution task.'],
      createdAt: now,
    };
  }

  private decompose(objective: string, context: DecisionContext, parentTaskId?: string): Array<{title: string; objective: string; priority: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'; acceptanceCriteria: string[]}> {
    const parent = parentTaskId ? context.taskGraph.tasks.find(task => task.id === parentTaskId) : undefined;
    const lines = objective.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const bulletLines = lines.filter(line => /^[-*•]|^\d+[.)]\s+/.test(line));
    const explicit = (bulletLines.length > 0 ? bulletLines : lines).map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
    const criteria = parent?.acceptanceCriteria ?? [];
    const units = explicit.length > 1 ? explicit : criteria.length > 1 ? criteria.map(item => item.trim()).filter(Boolean) : [objective.trim()];
    return units.filter(Boolean).map((unit, index) => ({
      title: this.title(unit, index),
      objective: unit,
      priority: /critical|security|blocker/i.test(unit) ? 'CRITICAL' : /urgent|failure|bug|fix/i.test(unit) ? 'HIGH' : 'MEDIUM',
      acceptanceCriteria: [unit],
    }));
  }

  private title(value: string, index: number): string {
    const clean = value.replace(/\s+/g, ' ').trim();
    return clean.length <= 80 ? clean : `Step ${index + 1}: ${clean.slice(0, 74)}...`;
  }
}
