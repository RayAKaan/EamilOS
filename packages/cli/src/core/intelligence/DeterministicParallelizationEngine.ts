import type { DecisionContext, JevDecision } from './types.js';

export class DeterministicParallelizationEngine {
  decide(context: DecisionContext): JevDecision {
    const maxConcurrentTasks = Number(context.mission.constraints.maxConcurrentTasks ?? 1);
    const capacity = Math.max(0, (Number.isFinite(maxConcurrentTasks) ? maxConcurrentTasks : 1) - context.taskGraph.runningTasks.length);
    const ready = context.taskGraph.readyTasks
      .map(id => context.taskGraph.tasks.find(task => task.id === id))
      .filter((task): task is NonNullable<typeof task> => Boolean(task));

    const independent = ready.filter(task => !ready.some(other =>
      other.id !== task.id &&
      (other.dependencies.includes(task.id) || task.dependencies.includes(other.id)),
    ));

    const selected = independent
      .sort((a, b) => this.priority(b.priority) - this.priority(a.priority) || a.id.localeCompare(b.id))
      .filter(task => !this.hasWriteConflict(task.id, independent.map(item => item.id), context))
      .slice(0, capacity);

    const action = selected.length >= 2 ? 'PARALLELIZE' : selected.length === 1 ? 'EXECUTE' : 'CONTINUE';
    return {
      decisionId: `det-parallel-${context.mission.id}-${context.taskGraph.version}`,
      missionId: context.mission.id,
      action,
      reasoning: selected.length >= 2
        ? `Selected ${selected.length} independent ready tasks within concurrency and resource constraints.`
        : selected.length === 1
          ? 'Exactly one safe ready task is available.'
          : 'No safe parallel execution set is currently available.',
      targets: selected.map(task => ({ taskId: task.id })),
      confidence: 0.99,
      expectedOutcome: selected.length ? 'Advance ready work without violating dependency/resource constraints.' : 'Wait for new readiness or recovery information.',
      contextVersion: context.taskGraph.version,
    };
  }

  private hasWriteConflict(taskId: string, taskIds: string[], context: DecisionContext): boolean {
    const resources = context.coordination.localPlans.flatMap(plan =>
      plan.todos.filter(todo => taskIds.includes(todo.taskId)).map(todo => ({
        taskId: todo.taskId,
        writes: todo.writeSet.map(resource => `${resource.kind}:${resource.id}:${resource.scope ?? '*'}`),
      })),
    );
    const current = resources.find(item => item.taskId === taskId);
    if (!current) return false;
    return current.writes.some(resource => resources.some(other => other.taskId !== taskId && other.writes.includes(resource)));
  }

  private priority(priority: string): number {
    return priority === 'CRITICAL' ? 100 : priority === 'HIGH' ? 75 : priority === 'MEDIUM' ? 50 : 25;
  }
}
