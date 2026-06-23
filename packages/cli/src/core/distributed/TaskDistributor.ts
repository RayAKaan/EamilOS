import { EventEmitter } from 'events';
import { NetworkManager } from './NetworkManager.js';
import { TaskStore } from './TaskStore.js';
import type {
  NetworkConfig,
  NodeCapabilities,
  NodeSelection,
  RemoteTaskResult,
  RemoteTaskPayload,
  SerializedAgentConfig,
  SerializedTaskConfig,
  DistributionStats,
  TaskPriority,
  TaskRejectedPayload,
  ModelCapability,
  ExecutionMode,
} from './types.js';

interface TaskAssignment {
  taskId: string;
  agentId: string;
  agentConfig: SerializedAgentConfig;
  assignedNode: string;
  status: 'pending' | 'dispatched' | 'running' | 'completed' | 'failed' | 'rerouted';
  dispatchedAt?: number;
  completedAt?: number;
  result?: RemoteTaskResult;
  error?: string;
  attempts: number;
  priority: TaskPriority;
  createdAt: number;
  escalationTier: number;
  excludedNodes: Set<string>;
}

interface NodeCandidate {
  nodeId: string;
  name: string;
  score: number;
  hasRequiredModel: boolean;
  isLocal: boolean;
  capabilities: NodeCapabilities;
}

export class TaskDistributor extends EventEmitter {
  private networkManager: NetworkManager;
  private config: NetworkConfig;
  private localCapabilities: NodeCapabilities;
  private assignments: Map<string, TaskAssignment> = new Map();
  private pendingResults: Map<string, {
    resolve: (value: RemoteTaskResult) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
  private taskStore?: TaskStore;
  private pendingQueue: string[] = [];

  constructor(
    networkManager: NetworkManager,
    localCapabilities: NodeCapabilities,
    config: NetworkConfig,
    taskStore?: TaskStore
  ) {
    super();
    this.networkManager = networkManager;
    this.localCapabilities = localCapabilities;
    this.config = config;
    this.taskStore = taskStore;

    this.setupEventListeners();
    this.recoverPendingTasks();
  }

  private setupEventListeners(): void {
    this.networkManager.on('network:worker-disconnected', (data: unknown) => {
      const info = data as { nodeId: string; activeTasks: Array<{ taskId: string; agentId: string }> };
      this.handleNodeFailure(info.nodeId, info.activeTasks);
    });

    this.networkManager.on('distribution:task-result', (data: unknown) => {
      const result = data as RemoteTaskResult;
      this.handleTaskResult(result.taskId, result);
    });

    this.networkManager.on('distribution:task-error', (data: unknown) => {
      const error = data as { taskId: string; error: string };
      this.handleTaskError(error.taskId, error.error);
    });

    this.networkManager.on('task:rejected', (data: unknown) => {
      const rejection = data as TaskRejectedPayload;
      this.handleTaskRejected(rejection);
    });

    this.networkManager.on('task:stream', (data: unknown) => {
      this.emit('task:stream', data);
    });
  }

  private recoverPendingTasks(): void {
    if (!this.taskStore) return;

    const pending = this.taskStore.getPending();
    for (const task of pending) {
      if (!this.assignments.has(task.taskId)) {
        this.pendingQueue.push(task.taskId);
      }
    }

    if (pending.length > 0) {
      this.emit('distribution:tasks-recovered', { count: pending.length });
    }
  }

  private priorityScore(priority?: TaskPriority): number {
    return priority === 'high' ? 3 : priority === 'normal' ? 2 : 1;
  }

  private sortPendingQueue(): void {
    const sorted: TaskAssignment[] = [];
    for (const taskId of this.pendingQueue) {
      const assignment = this.assignments.get(taskId);
      if (assignment) {
        sorted.push(assignment);
      }
    }

    sorted.sort((a, b) => {
      const priorityDiff = this.priorityScore(b.priority) - this.priorityScore(a.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt - b.createdAt;
    });

    this.pendingQueue = sorted.map((a) => a.taskId);
  }

  private canNodeRunModel(capabilities: NodeCapabilities, model: ModelCapability): boolean {
    if (model.requiresGPU) {
      const hasGPU = capabilities.gpus.some((g) => g.available);
      if (!hasGPU) return false;
    }

    if (model.minRAMGB) {
      const freeGB = capabilities.availableRAMBytes / (1024 ** 3);
      if (freeGB < model.minRAMGB) return false;
    }

    return true;
  }

  private getExecutionMode(): ExecutionMode {
    return this.config.execution.mode || 'hybrid';
  }

  private filterByExecutionMode(candidates: NodeCandidate[], preferLocal?: boolean): NodeCandidate[] {
    const mode = this.getExecutionMode();

    if (mode === 'local') {
      return candidates.filter((c) => c.isLocal);
    }

    if (mode === 'distributed') {
      return candidates.filter((c) => !c.isLocal);
    }

    if (preferLocal) {
      const local = candidates.filter((c) => c.isLocal);
      if (local.length > 0) return local;
    }

    return candidates;
  }

  selectNode(
    agentConfig: SerializedAgentConfig,
    modelId: string,
    excludedNodes?: Set<string>
  ): NodeSelection {
    const candidates: NodeCandidate[] = [];

    const localModel = this.localCapabilities.models.find((m) => m.modelId === modelId);
    if (localModel) {
      if (this.canNodeRunModel(this.localCapabilities, localModel)) {
        candidates.push({
          nodeId: 'local',
          name: 'local',
          score: this.scoreNode('local', this.localCapabilities, localModel),
          hasRequiredModel: true,
          isLocal: true,
          capabilities: this.localCapabilities,
        });
      }
    }

    for (const worker of this.networkManager.getConnectedWorkers()) {
      if (worker.connectionState !== 'ready' && worker.connectionState !== 'busy') continue;

      if (excludedNodes?.has(worker.identity.id)) continue;

      if (worker.capabilities.currentLoad >= worker.capabilities.maxConcurrentTasks) {
        continue;
      }

      const model = worker.capabilities.models.find((m) => m.modelId === modelId);
      if (!model) continue;

      if (!this.canNodeRunModel(worker.capabilities, model)) continue;

      candidates.push({
        nodeId: worker.identity.id,
        name: worker.identity.name,
        score: this.scoreNode(worker.identity.id, worker.capabilities, model),
        hasRequiredModel: true,
        isLocal: false,
        capabilities: worker.capabilities,
      });
    }

    const filteredCandidates = this.filterByExecutionMode(candidates, this.config.execution.preferLocalExecution);

    if (filteredCandidates.length === 0) {
      return {
        nodeId: null,
        reason: 'no-node-with-model',
        availableModels: this.getAllAvailableModels(),
      };
    }

    filteredCandidates.sort((a: NodeCandidate, b: NodeCandidate) => b.score - a.score);
    const selected = filteredCandidates[0];

    this.emit('distribution:node-selected', {
      taskAgent: agentConfig.id,
      model: modelId,
      selectedNode: selected.nodeId,
      selectedName: selected.name,
      score: selected.score,
      isLocal: selected.isLocal,
      candidateCount: filteredCandidates.length,
    });

    return {
      nodeId: selected.nodeId,
      name: selected.name,
      score: selected.score,
      isLocal: selected.isLocal,
      capabilities: selected.capabilities,
    };
  }

  private scoreNode(
    nodeId: string,
    capabilities: NodeCapabilities,
    model: ModelCapability
  ): number {
    let score = 0;

    const slotsAvailable = capabilities.maxConcurrentTasks - capabilities.currentLoad;
    if (slotsAvailable > 2) score += 25;
    else if (slotsAvailable > 0) score += 15;

    if (model.requiresGPU && capabilities.gpus.some((g) => g.available)) {
      score += 30;
    } else if (capabilities.gpus.some((g) => g.available)) {
      score += 20;
    }

    if (model.minRAMGB) {
      const freeGB = capabilities.availableRAMBytes / (1024 ** 3);
      const ratio = freeGB / model.minRAMGB;
      if (ratio > 4) score += 15;
      else if (ratio > 2) score += 10;
      else if (ratio > 1) score += 5;
      else score -= 20;
    } else {
      const freeGB = capabilities.availableRAMBytes / (1024 ** 3);
      if (freeGB > 32) score += 15;
      else if (freeGB > 16) score += 10;
      else if (freeGB > 8) score += 5;
    }

    if (model.loaded) score += 15;

    if (model.estimatedTokensPerSecond) {
      if (model.estimatedTokensPerSecond > 50) score += 10;
      else if (model.estimatedTokensPerSecond > 20) score += 7;
      else score += 3;
    }

    if (nodeId === 'local' && this.config.execution.preferLocalExecution) {
      score += 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  async dispatchRemote(
    taskId: string,
    agent: SerializedAgentConfig,
    task: SerializedTaskConfig,
    contextMessages: Array<{ role: string; content: string }>,
    nodeId: string,
    priority?: TaskPriority
  ): Promise<RemoteTaskResult> {
    const worker = this.networkManager.getWorkerConnection(nodeId);
    if (!worker) {
      throw new Error(`Worker node '${nodeId}' is not connected`);
    }

    if (worker.status.capabilities.currentLoad >= worker.status.capabilities.maxConcurrentTasks) {
      throw new Error(`Worker '${nodeId}' is at capacity`);
    }

    const now = Date.now();
    const taskPriority = priority || task.priority || 'normal';

    const assignment: TaskAssignment = {
      taskId,
      agentId: agent.id,
      agentConfig: agent,
      assignedNode: nodeId,
      status: 'dispatched',
      dispatchedAt: now,
      attempts: 1,
      priority: taskPriority,
      createdAt: now,
      escalationTier: 0,
      excludedNodes: new Set(),
    };
    this.assignments.set(taskId, assignment);
    this.pendingQueue.push(taskId);
    this.sortPendingQueue();

    if (this.taskStore) {
      this.taskStore.save({
        taskId,
        agentId: agent.id,
        model: agent.model || '',
        status: 'running',
        assignedNode: nodeId,
        priority: taskPriority,
        timestamp: now,
        attempts: 1,
      });
    }

    worker.status.capabilities.currentLoad++;
    worker.status.activeTasks.push({
      taskId,
      agentId: agent.id,
      model: agent.model || '',
      startedAt: now,
    });

    const taskPayload: RemoteTaskPayload = {
      taskId,
      agent,
      task,
      contextMessages,
      executionConfig: {
        timeout: agent.timeout || this.config.execution.taskTimeoutMs,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      },
      priority: taskPriority,
    };

    this.networkManager.sendMessage(
      worker.socket,
      'task:assign',
      taskPayload,
      nodeId
    );

    this.emit('distribution:task-dispatched', {
      taskId,
      agentId: agent.id,
      nodeId,
      nodeName: worker.status.identity.name,
      priority: taskPriority,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResults.delete(taskId);
        assignment.status = 'failed';
        assignment.error = 'Remote execution timeout';

        if (this.config.execution.retryOnNodeFailure && assignment.attempts < this.config.execution.maxTaskRetries) {
          this.rerouteTask(taskId, agent, task, contextMessages)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error(`Task '${taskId}' on node '${nodeId}' timed out`));
        }
      }, agent.timeout || this.config.execution.taskTimeoutMs);

      this.pendingResults.set(taskId, { resolve, reject, timeout });
    });
  }

  private handleTaskRejected(rejection: TaskRejectedPayload): void {
    const pending = this.pendingResults.get(rejection.taskId);
    if (!pending) return;

    this.emit('distribution:task-rejected', rejection);

    if (rejection.reason === 'capacity_full') {
      const assignment = this.assignments.get(rejection.taskId);
      if (assignment && this.config.execution.retryOnNodeFailure && assignment.attempts < this.config.execution.maxTaskRetries) {
        clearTimeout(pending.timeout);
        this.rerouteTask(rejection.taskId, assignment.agentConfig, {
          id: rejection.taskId,
          description: '',
          input: {},
          priority: assignment.priority,
        }, []);
      } else {
        pending.reject(new Error(`Task rejected: ${rejection.reason}`));
      }
    } else {
      pending.reject(new Error(`Task rejected: ${rejection.reason} - ${rejection.details || ''}`));
    }
  }

  handleTaskResult(taskId: string, result: RemoteTaskResult): void {
    const pending = this.pendingResults.get(taskId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingResults.delete(taskId);

    const assignment = this.assignments.get(taskId);
    if (assignment) {
      assignment.status = result.success ? 'completed' : 'failed';
      assignment.completedAt = Date.now();
      assignment.result = result;
    }

    this.pendingQueue = this.pendingQueue.filter((id) => id !== taskId);

    const worker = this.networkManager.getWorkerConnection(result.nodeId);
    if (worker) {
      worker.status.capabilities.currentLoad = Math.max(0, worker.status.capabilities.currentLoad - 1);
      worker.status.activeTasks = worker.status.activeTasks.filter((t) => t.taskId !== taskId);
    }

    if (this.taskStore) {
      if (result.success) {
        this.taskStore.markCompleted(taskId, result);
      } else {
        this.taskStore.markFailed(taskId, result.error);
      }
    }

    if (result.success) {
      pending.resolve(result);
    } else {
      pending.reject(new Error(result.error || 'Remote task failed'));
    }
  }

  private handleTaskError(taskId: string, error: string): void {
    const pending = this.pendingResults.get(taskId);
    if (!pending) return;

    const assignment = this.assignments.get(taskId);
    if (assignment && this.config.execution.retryOnNodeFailure && assignment.attempts < this.config.execution.maxTaskRetries) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(error));
    } else if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(error));
    }
  }

  private async rerouteTask(
    taskId: string,
    agent: SerializedAgentConfig,
    task: SerializedTaskConfig,
    contextMessages: Array<{ role: string; content: string }>
  ): Promise<RemoteTaskResult> {
    const assignment = this.assignments.get(taskId);
    if (assignment) {
      assignment.status = 'rerouted';
      assignment.attempts++;
      assignment.escalationTier++;
    }

    if (this.taskStore) {
      this.taskStore.incrementAttempts(taskId);
    }

    this.emit('distribution:task-rerouted', {
      taskId,
      agentId: agent.id,
      attempt: assignment?.attempts || 2,
      previousNode: assignment?.assignedNode,
      escalationTier: assignment?.escalationTier || 1,
    });

    const selection = this.selectNode(agent, agent.model || '', assignment?.excludedNodes);

    if (!selection.nodeId) {
      throw new Error('No nodes available for task reroute');
    }

    if (selection.isLocal) {
      this.emit('distribution:fallback-local', {
        taskId,
        agentId: agent.id,
        reason: 'no remote nodes available for reroute',
      });

      return {
        success: false,
        nodeId: 'local',
        taskId,
        fallbackToLocal: true,
        error: 'Rerouted to local execution',
      };
    }

    return this.dispatchRemote(taskId, agent, task, contextMessages, selection.nodeId!, assignment?.priority);
  }

  private handleNodeFailure(
    nodeId: string,
    activeTasks: Array<{ taskId: string; agentId: string }>
  ): void {
    for (const task of activeTasks) {
      const pending = this.pendingResults.get(task.taskId);
      if (!pending) continue;

      this.emit('distribution:node-failed-during-task', {
        taskId: task.taskId,
        agentId: task.agentId,
        failedNode: nodeId,
      });
    }
  }

  private getAllAvailableModels(): string[] {
    const models = new Set<string>();

    for (const model of this.localCapabilities.models) {
      models.add(model.modelId);
    }

    for (const worker of this.networkManager.getConnectedWorkers()) {
      for (const model of worker.capabilities.models) {
        models.add(model.modelId);
      }
    }

    return Array.from(models);
  }

  getStats(): DistributionStats {
    const assignments = Array.from(this.assignments.values());
    return {
      totalDispatched: assignments.length,
      completed: assignments.filter((a) => a.status === 'completed').length,
      failed: assignments.filter((a) => a.status === 'failed').length,
      rerouted: assignments.filter((a) => a.status === 'rerouted').length,
      pending: assignments.filter((a) => a.status === 'dispatched' || a.status === 'pending').length,
      byNode: this.groupBy(assignments, (a) => a.assignedNode),
    };
  }

  getTaskStore(): TaskStore | undefined {
    return this.taskStore;
  }

  getPendingQueue(): string[] {
    return [...this.pendingQueue];
  }

  private groupBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
    const result: Record<string, number> = {};
    for (const item of items) {
      const k = key(item);
      result[k] = (result[k] || 0) + 1;
    }
    return result;
  }
}
