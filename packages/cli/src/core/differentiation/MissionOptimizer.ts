import type { TaskNode } from '../mission/types.js';

export interface OptimizationConstraint {
  maxConcurrentTasks?: number;
  maxAttempts?: number;
  preferParallel?: boolean;
}

export interface OptimizedPlan {
  orderedTaskIds: string[];
  waves: string[][];
  criticalPath: string[];
}

export class MissionOptimizer {
  optimize(tasks: readonly TaskNode[], constraints: OptimizationConstraint = {}): OptimizedPlan {
    const byId = new Map(tasks.map(task => [task.id, task]));
    const remaining = new Set(tasks.map(task => task.id));
    const waves: string[][] = [];
    const maxConcurrent = Math.max(1, constraints.maxConcurrentTasks ?? Number.MAX_SAFE_INTEGER);

    while (remaining.size) {
      const ready = [...remaining]
        .filter(id => (byId.get(id)?.dependencies ?? []).every(dep => !remaining.has(dep)))
        .sort((a, b) => this.priority(byId.get(b)!) - this.priority(byId.get(a)!) || a.localeCompare(b));

      if (!ready.length) throw new Error('Mission task graph contains a dependency cycle');
      const wave = (constraints.preferParallel === false ? ready.slice(0, 1) : ready.slice(0, maxConcurrent));
      waves.push(wave);
      wave.forEach(id => remaining.delete(id));
    }

    const orderedTaskIds = waves.flat();
    const criticalPath = this.criticalPath(tasks);
    return { orderedTaskIds, waves, criticalPath };
  }

  private priority(task: TaskNode): number {
    return ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 })[task.priority];
  }

  private criticalPath(tasks: readonly TaskNode[]): string[] {
    const byId = new Map(tasks.map(task => [task.id, task]));
    const memo = new Map<string, string[]>();
    const visit = (id: string, active = new Set<string>()): string[] => {
      if (memo.has(id)) return memo.get(id)!;
      if (active.has(id)) throw new Error('Mission task graph contains a dependency cycle');
      const next = byId.get(id);
      if (!next) return [];
      const path = new Set(active);
      path.add(id);
      const parents = next.dependencies.map(dep => visit(dep, path));
      const longest = parents.sort((a, b) => b.length - a.length)[0] ?? [];
      const result = [...longest, id];
      memo.set(id, result);
      return result;
    };
    return tasks.map(t => visit(t.id)).sort((a, b) => b.length - a.length)[0] ?? [];
  }
}
