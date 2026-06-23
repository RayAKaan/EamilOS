import { ExplainableError } from "../errors/ExplainableError.js";

export interface TaskDependency {
  taskId: string;
  dependsOn: string[];
}

export class DependencyGraph {
  private deps: Map<string, string[]> = new Map();

  addTask(taskId: string, dependsOn: string[] = []): void {
    this.deps.set(taskId, dependsOn);
  }

  getDependencies(taskId: string): string[] {
    return this.deps.get(taskId) || [];
  }

  hasTask(taskId: string): boolean {
    return this.deps.has(taskId);
  }

  validateNoCycles(): void {
    const inDegree: Map<string, number> = new Map();
    const adj: Map<string, string[]> = new Map();

    for (const [task, dependencies] of this.deps) {
      if (!inDegree.has(task)) inDegree.set(task, 0);
      if (!adj.has(task)) adj.set(task, []);

      for (const dep of dependencies) {
        if (!adj.has(dep)) adj.set(dep, []);
        adj.get(dep)!.push(task);
        inDegree.set(task, (inDegree.get(task) || 0) + 1);
      }
    }

    const queue = [...inDegree.entries()]
      .filter(([, d]) => d === 0)
      .map(([t]) => t);
    let visited = 0;

    while (queue.length > 0) {
      const node = queue.shift()!;
      visited++;

      for (const neighbor of adj.get(node) || []) {
        const newDegree = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    if (visited < this.deps.size) {
      const stuck = [...inDegree.entries()]
        .filter(([, d]) => d > 0)
        .map(([t]) => t);

      throw new ExplainableError({
        code: "CIRCULAR_DEPENDENCY",
        title: "Circular Task Dependency Detected",
        message: `Tasks have circular dependencies and cannot be ordered.`,
        fixes: [
          `Involved tasks: ${stuck.join(", ")}`,
          `Review 'dependsOn' fields in your configuration`,
          `Remove or restructure the circular reference`,
        ],
      });
    }
  }

  getExecutionGroups(): string[][] {
    const groups: string[][] = [];
    const remaining = new Set(this.deps.keys());
    const completed = new Set<string>();

    while (remaining.size > 0) {
      const group = [...remaining].filter((task) =>
        this.getDependencies(task).every((dep) => completed.has(dep))
      );

      if (group.length === 0) break;

      groups.push(group);
      group.forEach((t) => {
        remaining.delete(t);
        completed.add(t);
      });
    }

    return groups;
  }

  getReadyTasks(completed: Set<string>): string[] {
    return [...this.deps.keys()].filter(
      (task) =>
        !completed.has(task) &&
        this.getDependencies(task).every((dep) => completed.has(dep))
    );
  }

  static fromTasks(tasks: TaskDependency[]): DependencyGraph {
    const graph = new DependencyGraph();
    for (const task of tasks) {
      graph.addTask(task.taskId, task.dependsOn);
    }
    return graph;
  }
}
