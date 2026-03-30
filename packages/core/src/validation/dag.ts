export interface DAGNode {
  id: string;
  dependencies: Set<string>;
}

export interface DAGValidationResult {
  valid: boolean;
  error?: string;
  cycle?: string[];
}

export function validateDAG(nodes: Map<string, DAGNode>): DAGValidationResult {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function hasCycle(nodeId: string): string[] | null {
    if (recursionStack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      return [...path.slice(cycleStart), nodeId];
    }

    if (visited.has(nodeId)) {
      return null;
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);

    const node = nodes.get(nodeId);
    if (node) {
      for (const depId of node.dependencies) {
        const cycle = hasCycle(depId);
        if (cycle) {
          return cycle;
        }
      }
    }

    path.pop();
    recursionStack.delete(nodeId);
    return null;
  }

  for (const nodeId of nodes.keys()) {
    visited.clear();
    recursionStack.clear();
    path.length = 0;

    const cycle = hasCycle(nodeId);
    if (cycle) {
      return {
        valid: false,
        error: `Circular dependency detected: ${cycle.join(' -> ')}`,
        cycle,
      };
    }
  }

  return { valid: true };
}

export function validateTaskDependencies(
  tasks: Array<{ id: string; dependsOn: string[] }>
): DAGValidationResult {
  const nodes = new Map<string, DAGNode>();

  for (const task of tasks) {
    nodes.set(task.id, {
      id: task.id,
      dependencies: new Set(task.dependsOn),
    });
  }

  return validateDAG(nodes);
}

export function getTopologicalOrder(nodes: Map<string, DAGNode>): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  function visit(nodeId: string): void {
    if (temp.has(nodeId)) {
      return;
    }
    if (visited.has(nodeId)) {
      return;
    }

    temp.add(nodeId);

    const node = nodes.get(nodeId);
    if (node) {
      for (const depId of node.dependencies) {
        visit(depId);
      }
    }

    temp.delete(nodeId);
    visited.add(nodeId);
    result.push(nodeId);
  }

  for (const nodeId of nodes.keys()) {
    if (!visited.has(nodeId)) {
      visit(nodeId);
    }
  }

  return result;
}

export function getReadyTasks(
  allTasks: Array<{ id: string; dependsOn: string[]; status: string }>,
  completedTaskIds: Set<string>
): string[] {
  return allTasks
    .filter((task) => {
      if (task.status !== 'pending' && task.status !== 'ready') {
        return false;
      }

      return task.dependsOn.every((depId) => completedTaskIds.has(depId));
    })
    .map((task) => task.id);
}

export function getDependencyDepth(
  taskId: string,
  nodes: Map<string, DAGNode>,
  cache: Map<string, number> = new Map()
): number {
  if (cache.has(taskId)) {
    return cache.get(taskId)!;
  }

  const node = nodes.get(taskId);
  if (!node || node.dependencies.size === 0) {
    cache.set(taskId, 0);
    return 0;
  }

  let maxDepth = 0;
  for (const depId of node.dependencies) {
    const depDepth = getDependencyDepth(depId, nodes, cache);
    maxDepth = Math.max(maxDepth, depDepth);
  }

  const depth = maxDepth + 1;
  cache.set(taskId, depth);
  return depth;
}

export function groupByDepth(
  nodes: Map<string, DAGNode>
): Map<number, string[]> {
  const depthGroups = new Map<number, string[]>();
  const depthCache = new Map<string, number>();

  for (const nodeId of nodes.keys()) {
    const depth = getDependencyDepth(nodeId, nodes, depthCache);
    const group = depthGroups.get(depth) ?? [];
    group.push(nodeId);
    depthGroups.set(depth, group);
  }

  return depthGroups;
}

export function getTransitiveDependencies(
  taskId: string,
  nodes: Map<string, DAGNode>
): Set<string> {
  const result = new Set<string>();
  const visited = new Set<string>();

  function collect(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);

    const node = nodes.get(id);
    if (node) {
      for (const depId of node.dependencies) {
        result.add(depId);
        collect(depId);
      }
    }
  }

  collect(taskId);
  return result;
}

export function canExecuteParallel(
  taskIds: string[],
  nodes: Map<string, DAGNode>
): boolean {
  const taskSet = new Set(taskIds);

  for (const taskId of taskIds) {
    const node = nodes.get(taskId);
    if (!node) continue;

    for (const depId of node.dependencies) {
      if (taskSet.has(depId)) {
        return false;
      }
    }

    for (const otherId of taskIds) {
      if (taskId === otherId) continue;

      const otherNode = nodes.get(otherId);
      if (otherNode?.dependencies.has(taskId)) {
        return false;
      }
    }
  }

  return true;
}
