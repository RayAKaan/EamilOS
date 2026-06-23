import type { AgentRole } from './AgentType.js';

export type TaskStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface ExecutionNode {
  id: string;
  taskId: string;
  role: AgentRole;
  agentId?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dependencies: string[];
  dependents: string[];
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  error?: string;
  startTime?: number;
  endTime?: number;
  timeout: number;
  retryCount: number;
  maxRetries: number;
}

export interface ExecutionGraphConfig {
  maxConcurrentTasks: number;
  defaultTimeout: number;
  defaultMaxRetries: number;
  allowCircularDependencies: boolean;
}

const DEFAULT_CONFIG: ExecutionGraphConfig = {
  maxConcurrentTasks: 5,
  defaultTimeout: 120000,
  defaultMaxRetries: 3,
  allowCircularDependencies: false,
};

export interface GraphValidationResult {
  valid: boolean;
  cycles: string[][];
  missingDependencies: string[];
  unreachableNodes: string[];
  errors: string[];
}

export interface ExecutionSchedule {
  phases: ExecutionPhase[];
  estimatedDuration: number;
  criticalPath: string[];
}

export interface ExecutionPhase {
  phase: number;
  nodes: ExecutionNode[];
  canRunParallel: boolean;
}

export class ExecutionGraph {
  private nodes: Map<string, ExecutionNode> = new Map();
  private config: ExecutionGraphConfig;
  private topologicalOrder: string[] = [];
  private phases: ExecutionPhase[] = [];
  private statusListeners: Array<(node: ExecutionNode) => void> = [];

  constructor(config: Partial<ExecutionGraphConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  addNode(
    taskId: string,
    role: AgentRole,
    dependencies: string[] = [],
    priority: TaskPriority = 'normal',
    timeout?: number,
    maxRetries?: number,
    inputs?: Record<string, unknown>
  ): string {
    const id = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const node: ExecutionNode = {
      id,
      taskId,
      role,
      status: 'pending',
      priority,
      dependencies: [...dependencies],
      dependents: [],
      inputs: inputs || {},
      outputs: {},
      timeout: timeout || this.config.defaultTimeout,
      retryCount: 0,
      maxRetries: maxRetries || this.config.defaultMaxRetries,
    };

    this.nodes.set(id, node);

    for (const depId of dependencies) {
      const depNode = this.nodes.get(depId);
      if (depNode) {
        depNode.dependents.push(id);
      }
    }

    this.invalidateCache();

    return id;
  }

  getNode(id: string): ExecutionNode | undefined {
    return this.nodes.get(id);
  }

  getNodeByTaskId(taskId: string): ExecutionNode | undefined {
    for (const node of this.nodes.values()) {
      if (node.taskId === taskId) {
        return node;
      }
    }
    return undefined;
  }

  getNodesByRole(role: AgentRole): ExecutionNode[] {
    return Array.from(this.nodes.values()).filter(n => n.role === role);
  }

  getNodesByStatus(status: TaskStatus): ExecutionNode[] {
    return Array.from(this.nodes.values()).filter(n => n.status === status);
  }

  updateNodeStatus(id: string, status: TaskStatus, error?: string): boolean {
    const node = this.nodes.get(id);
    if (!node) {
      return false;
    }

    node.status = status;

    if (status === 'running' && !node.startTime) {
      node.startTime = Date.now();
    }

    if ((status === 'completed' || status === 'failed' || status === 'cancelled') && !node.endTime) {
      node.endTime = Date.now();
    }

    if (error) {
      node.error = error;
    }

    this.notifyStatusChange(node);

    if (status === 'completed') {
      this.updateDependentNodes(id);
    }

    return true;
  }

  setNodeOutput(id: string, outputs: Record<string, unknown>): boolean {
    const node = this.nodes.get(id);
    if (!node) {
      return false;
    }

    node.outputs = { ...node.outputs, ...outputs };
    return true;
  }

  getNodeOutput(id: string, key: string): unknown {
    const node = this.nodes.get(id);
    return node?.outputs[key];
  }

  getReadyNodes(): ExecutionNode[] {
    return Array.from(this.nodes.values()).filter(node => {
      if (node.status !== 'ready') {
        return false;
      }

      for (const depId of node.dependencies) {
        const depNode = this.nodes.get(depId);
        if (!depNode || depNode.status !== 'completed') {
          return false;
        }
      }

      return true;
    });
  }

  private updateDependentNodes(completedId: string): void {
    for (const node of this.nodes.values()) {
      if (node.status === 'pending' && node.dependencies.includes(completedId)) {
        const allDependenciesMet = node.dependencies.every(depId => {
          const depNode = this.nodes.get(depId);
          return depNode?.status === 'completed';
        });

        if (allDependenciesMet) {
          node.status = 'ready';
          this.notifyStatusChange(node);
        }
      }
    }
  }

  validate(): GraphValidationResult {
    const result: GraphValidationResult = {
      valid: true,
      cycles: [],
      missingDependencies: [],
      unreachableNodes: [],
      errors: [],
    };

    for (const node of this.nodes.values()) {
      for (const depId of node.dependencies) {
        if (!this.nodes.has(depId)) {
          result.missingDependencies.push(`${node.id} -> ${depId}`);
          result.valid = false;
        }
      }
    }

    const cycles = this.detectCycles();
    if (cycles.length > 0) {
      result.cycles = cycles;
      if (!this.config.allowCircularDependencies) {
        result.valid = false;
        result.errors.push(`Circular dependencies detected: ${cycles.map(c => c.join(' -> ')).join(', ')}`);
      }
    }

    const reachable = this.findReachableNodes();
    for (const node of this.nodes.values()) {
      if (!reachable.has(node.id) && node.dependencies.length > 0) {
        result.unreachableNodes.push(node.id);
      }
    }

    return result;
  }

  private detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const depId of node.dependencies) {
          if (!visited.has(depId)) {
            if (dfs(depId)) {
              return true;
            }
          } else if (recursionStack.has(depId)) {
            const cycleStart = path.indexOf(depId);
            const cycle = [...path.slice(cycleStart), depId];
            cycles.push(cycle);
          }
        }
      }

      path.pop();
      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return cycles;
  }

  private findReachableNodes(): Set<string> {
    const reachable = new Set<string>();
    const queue: string[] = [];

    for (const node of this.nodes.values()) {
      if (node.dependencies.length === 0) {
        queue.push(node.id);
        reachable.add(node.id);
      }
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const node = this.nodes.get(nodeId);

      if (node) {
        for (const dependentId of node.dependents) {
          if (!reachable.has(dependentId)) {
            reachable.add(dependentId);
            queue.push(dependentId);
          }
        }
      }
    }

    return reachable;
  }

  computeTopologicalOrder(): string[] {
    if (this.topologicalOrder.length === this.nodes.size) {
      return this.topologicalOrder;
    }

    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) {
        return;
      }
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const depId of node.dependencies) {
          visit(depId);
        }
        order.push(nodeId);
      }
    };

    for (const nodeId of this.nodes.keys()) {
      visit(nodeId);
    }

    this.topologicalOrder = order;
    return order;
  }

  computeExecutionSchedule(): ExecutionSchedule {
    const order = this.computeTopologicalOrder();
    const phases: ExecutionPhase[] = [];
    const phaseNodes = new Map<number, Set<string>>();
    const nodeToPhase = new Map<string, number>();

    for (const nodeId of order) {
      const node = this.nodes.get(nodeId);
      if (!node) continue;

      let maxPhase = 0;
      for (const depId of node.dependencies) {
        const depPhase = nodeToPhase.get(depId);
        if (depPhase !== undefined) {
          maxPhase = Math.max(maxPhase, depPhase + 1);
        }
      }

      nodeToPhase.set(nodeId, maxPhase);

      if (!phaseNodes.has(maxPhase)) {
        phaseNodes.set(maxPhase, new Set());
      }
      phaseNodes.get(maxPhase)!.add(nodeId);
    }

    let phaseNum = 0;
    while (phaseNodes.has(phaseNum)) {
      const nodeIds = phaseNodes.get(phaseNum)!;
      const nodes = Array.from(nodeIds).map(id => this.nodes.get(id)!).filter(Boolean);

      phases.push({
        phase: phaseNum,
        nodes,
        canRunParallel: nodes.every(n => !nodes.some(other => other.dependencies.includes(n.id))),
      });

      phaseNum++;
    }

    this.phases = phases;

    let estimatedDuration = 0;
    for (const phase of phases) {
      const phaseDuration = Math.max(...phase.nodes.map(n => n.timeout));
      estimatedDuration += phaseDuration;
    }

    const criticalPath = this.findCriticalPath();

    return { phases, estimatedDuration, criticalPath };
  }

  private findCriticalPath(): string[] {
    const earliestStart = new Map<string, number>();
    const earliestFinish = new Map<string, number>();

    const order = this.computeTopologicalOrder();

    for (const nodeId of order) {
      const node = this.nodes.get(nodeId);
      if (!node) continue;

      let maxPredFinish = 0;
      for (const depId of node.dependencies) {
        const predFinish = earliestFinish.get(depId) || 0;
        maxPredFinish = Math.max(maxPredFinish, predFinish);
      }

      earliestStart.set(nodeId, maxPredFinish);
      earliestFinish.set(nodeId, maxPredFinish + node.timeout);
    }

    const maxFinish = Math.max(...Array.from(earliestFinish.values()));

    const criticalPath: string[] = [];
    let currentNodeId = order.find(id => earliestFinish.get(id) === maxFinish);

    while (currentNodeId) {
      criticalPath.unshift(currentNodeId);

      const node = this.nodes.get(currentNodeId);
      if (!node) break;

      let maxPredStart = -1;
      let predNodeId: string | undefined;

      for (const depId of node.dependencies) {
        const predStart = earliestStart.get(depId) || 0;
        if (predStart >= maxPredStart) {
          maxPredStart = predStart;
          predNodeId = depId;
        }
      }

      currentNodeId = predNodeId!;
    }

    return criticalPath;
  }

  getExecutionPhases(): ExecutionPhase[] {
    if (this.phases.length === 0) {
      this.computeExecutionSchedule();
    }
    return this.phases;
  }

  getParallelBatches(): ExecutionNode[][] {
    const schedule = this.computeExecutionSchedule();
    const batches: ExecutionNode[][] = [];

    for (const phase of schedule.phases) {
      if (phase.canRunParallel) {
        batches.push(phase.nodes);
      } else {
        for (const node of phase.nodes) {
          batches.push([node]);
        }
      }
    }

    return batches;
  }

  removeNode(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) {
      return false;
    }

    for (const depId of node.dependencies) {
      const depNode = this.nodes.get(depId);
      if (depNode) {
        depNode.dependents = depNode.dependents.filter(d => d !== id);
      }
    }

    for (const dependentId of node.dependents) {
      const dependentNode = this.nodes.get(dependentId);
      if (dependentNode) {
        dependentNode.dependencies = dependentNode.dependencies.filter(d => d !== id);
      }
    }

    this.nodes.delete(id);
    this.invalidateCache();

    return true;
  }

  cancelNode(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) {
      return false;
    }

    if (node.status === 'completed' || node.status === 'cancelled') {
      return false;
    }

    this.updateNodeStatus(id, 'cancelled');

    for (const dependentId of node.dependents) {
      this.cancelNode(dependentId);
    }

    return true;
  }

  private invalidateCache(): void {
    this.topologicalOrder = [];
    this.phases = [];
  }

  onStatusChange(listener: (node: ExecutionNode) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      const idx = this.statusListeners.indexOf(listener);
      if (idx >= 0) {
        this.statusListeners.splice(idx, 1);
      }
    };
  }

  private notifyStatusChange(node: ExecutionNode): void {
    for (const listener of this.statusListeners) {
      try {
        listener(node);
      } catch {
        // Ignore listener errors
      }
    }
  }

  getStats(): {
    total: number;
    pending: number;
    ready: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    averageDuration: number;
    successRate: number;
  } {
    const nodes = Array.from(this.nodes.values());

    const byStatus = {
      pending: nodes.filter(n => n.status === 'pending').length,
      ready: nodes.filter(n => n.status === 'ready').length,
      running: nodes.filter(n => n.status === 'running').length,
      completed: nodes.filter(n => n.status === 'completed').length,
      failed: nodes.filter(n => n.status === 'failed').length,
      cancelled: nodes.filter(n => n.status === 'cancelled').length,
    };

    const completedNodes = nodes.filter(n => n.status === 'completed' && n.endTime && n.startTime);
    const totalDuration = completedNodes.reduce((sum, n) => sum + ((n.endTime || 0) - (n.startTime || 0)), 0);
    const averageDuration = completedNodes.length > 0 ? totalDuration / completedNodes.length : 0;

    const finishedNodes = nodes.filter(n => n.status === 'completed' || n.status === 'failed');
    const successRate = finishedNodes.length > 0
      ? (byStatus.completed / finishedNodes.length) * 100
      : 100;

    return {
      total: nodes.length,
      ...byStatus,
      averageDuration,
      successRate,
    };
  }

  clear(): void {
    this.nodes.clear();
    this.invalidateCache();
  }

  clone(): ExecutionGraph {
    const cloned = new ExecutionGraph(this.config);

    for (const node of this.nodes.values()) {
      const newNode: ExecutionNode = { ...node };
      cloned.nodes.set(newNode.id, newNode);
    }

    for (const node of cloned.nodes.values()) {
      node.dependents = node.dependents.map(depId => {
        const original = this.nodes.get(depId);
        const clonedDep = Array.from(cloned.nodes.values()).find(n => n.taskId === original?.taskId);
        return clonedDep?.id || depId;
      });
    }

    return cloned;
  }
}
