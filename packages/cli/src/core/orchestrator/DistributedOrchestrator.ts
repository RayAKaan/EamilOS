import { EventEmitter } from 'events';
import type { AgentRole } from '../collaboration/AgentType.js';
import { getAgentType, getDependencies } from '../collaboration/AgentType.js';
import { ExecutionGraph, type ExecutionNode, type TaskPriority } from '../collaboration/ExecutionGraph.js';
import { DistributedCommsGround } from '../comms/DistributedCommsGround.js';
import { DistributedMemory } from '../memory/DistributedMemory.js';
import { DistributedAgentCommunicator, type DistributedAgentIdentity } from '../comms/DistributedAgentCommunicator.js';
import { VectorClock } from '../comms/VectorClock.js';
import { ContextBuilder, type BuiltContext } from '../collaboration/ContextBuilder.js';
import { withTimeout } from '../utils/withTimeout.js';
import { retry } from '../utils/retry.js';
import { getLogger, type Logger } from '../logger.js';
import type { VectorClockSnapshot } from '../comms/VectorClock.js';

export interface DistributedOrchestratorConfig {
  maxConcurrentAgents: number;
  defaultTimeout: number;
  maxRetries: number;
  retryDelay: number;
  enableStateCleanup: boolean;
  abortOnTimeout: boolean;
  cleanupDelay: number;
  nodeId: string;
  enableCrossNodeCollaboration: boolean;
  collaborationSyncInterval: number;
  maxMessageDelay: number;
}

const DEFAULT_CONFIG: Omit<DistributedOrchestratorConfig, 'nodeId'> = {
  maxConcurrentAgents: 3,
  defaultTimeout: 120000,
  maxRetries: 3,
  retryDelay: 1000,
  enableStateCleanup: true,
  abortOnTimeout: true,
  cleanupDelay: 500,
  enableCrossNodeCollaboration: true,
  collaborationSyncInterval: 5000,
  maxMessageDelay: 30000,
};

export interface DistributedAgentExecution {
  agentId: string;
  role: AgentRole;
  nodeId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled' | 'waiting-for-deps';
  startTime?: number;
  endTime?: number;
  result?: unknown;
  error?: string;
  context?: BuiltContext;
  taskId: string;
  vectorClock?: VectorClockSnapshot;
}

export interface DistributedOrchestrationResult {
  success: boolean;
  completedAgents: string[];
  failedAgents: string[];
  timedOutAgents: string[];
  artifacts: Record<string, unknown>;
  executionTime: number;
  errors: string[];
  taskGraph: Record<string, string[]>;
  causalOrder: VectorClockSnapshot[];
}

export interface CrossNodeTask {
  taskId: string;
  parentTaskId?: string;
  childTaskIds: string[];
  createdBy: string;
  createdNode: string;
  assignedTo?: string;
  assignedNode?: string;
  status: 'created' | 'assigned' | 'in-progress' | 'completed' | 'failed';
  vectorClock: VectorClockSnapshot;
  priority: TaskPriority;
}

export interface CollaborationLoop {
  id: string;
  taskId: string;
  participants: string[];
  currentPhase: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  createdAt: number;
  lastSyncAt: number;
  rounds: number;
}

export interface AgentExecutor {
  (context: BuiltContext, agent: DistributedAgentIdentity, node: ExecutionNode, taskId: string, vectorClock: VectorClockSnapshot): Promise<unknown>;
}

export class DistributedOrchestrator extends EventEmitter {
  private config: Required<DistributedOrchestratorConfig>;
  private executionGraph: ExecutionGraph;
  private commsGround: DistributedCommsGround;
  private distributedMemory: DistributedMemory;
  private communicator: DistributedAgentCommunicator;
  private vectorClock: VectorClock;
  private contextBuilder: ContextBuilder;
  private logger: Logger;
  private activeExecutions: Map<string, DistributedAgentExecution> = new Map();
  private agentRegistry: Map<string, DistributedAgentIdentity> = new Map();
  private executorRegistry: Map<AgentRole, AgentExecutor> = new Map();
  private stateListeners: Array<(state: Map<string, DistributedAgentExecution>) => void> = [];
  private abortController: AbortController | null = null;
  private executionStartTime: number = 0;
  private crossNodeTasks: Map<string, CrossNodeTask> = new Map();
  private collaborationLoops: Map<string, CollaborationLoop> = new Map();
  private pendingTaskMessages: Map<string, unknown> = new Map();
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: DistributedOrchestratorConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<DistributedOrchestratorConfig>;
    this.vectorClock = new VectorClock(this.config.nodeId);

    const eventBus = new EventEmitter();
    this.commsGround = new DistributedCommsGround(this.config.nodeId, eventBus);
    this.distributedMemory = new DistributedMemory({
      nodeId: this.config.nodeId,
      maxEntries: 1000,
      conflictResolution: 'version-merge',
      conflictStrategy: 'version-wins',
    });
    this.communicator = new DistributedAgentCommunicator(this.config.nodeId);
    this.executionGraph = new ExecutionGraph({
      maxConcurrentTasks: this.config.maxConcurrentAgents,
      defaultTimeout: this.config.defaultTimeout,
      defaultMaxRetries: this.config.maxRetries,
    });
    this.contextBuilder = new ContextBuilder();
    this.logger = getLogger();

    this.setupStateListeners();
    this.setupEventHandlers();

    if (this.config.enableCrossNodeCollaboration) {
      this.startCollaborationSync();
    }
  }

  private setupStateListeners(): void {
    this.executionGraph.onStatusChange(() => {
      this.notifyStateChange();
    });
  }

  private setupEventHandlers(): void {
    this.commsGround.on('message', (message: unknown) => {
      this.handleIncomingMessage(message);
    });

    this.commsGround.on('sync', (data: unknown) => {
      this.handleSyncMessage(data);
    });
  }

  private handleIncomingMessage(message: unknown): void {
    const msg = message as { taskId?: string; type?: string; metadata?: Record<string, unknown> };
    if (!msg.taskId) return;

    const task = this.crossNodeTasks.get(msg.taskId);
    if (task) {
      task.vectorClock = (message as { vectorClock?: VectorClockSnapshot }).vectorClock || task.vectorClock;
      this.distributedMemory.receiveRemoteEntry({
        key: `task:${msg.taskId}`,
        value: msg,
        version: 1,
        timestamp: Date.now(),
        agentId: msg.metadata?.sender as string || 'unknown',
        vectorClock: task.vectorClock,
        causalRank: 0,
        originatedFrom: this.config.nodeId,
      });
    }

    this.emit('crossNodeMessage', message);
  }

  private handleSyncMessage(data: unknown): void {
    this.emit('sync', data);
  }

  private startCollaborationSync(): void {
    this.syncInterval = setInterval(() => {
      this.syncWithNodes();
    }, this.config.collaborationSyncInterval);
  }

  private async syncWithNodes(): Promise<void> {
    try {
      const pendingTasks = Array.from(this.crossNodeTasks.values());
      const pendingMessages = this.pendingTaskMessages.size;

      this.logger.debug('Syncing with nodes', {
        metadata: {
          pendingTasks: pendingTasks.length,
          pendingMessages,
          nodeId: this.config.nodeId,
        },
      });

      for (const loop of this.collaborationLoops.values()) {
        if (loop.status === 'active') {
          this.updateCollaborationLoop(loop.id);
        }
      }
    } catch (error) {
      this.logger.error('Sync error', { metadata: { error: String(error) } });
    }
  }

  registerExecutor(role: AgentRole, executor: AgentExecutor): void {
    this.executorRegistry.set(role, executor);
  }

  registerAgent(identity: DistributedAgentIdentity): void {
    this.agentRegistry.set(identity.id, identity);
  }

  registerNode(nodeId: string, agentIdentity: DistributedAgentIdentity): void {
    this.agentRegistry.set(nodeId, agentIdentity);
  }

  createTask(
    _goal: string,
    _role: AgentRole,
    priority: TaskPriority = 'normal',
    parentTaskId?: string
  ): CrossNodeTask {
    const taskId = `task_${this.config.nodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const vectorClock = this.vectorClock.tick();

    const task: CrossNodeTask = {
      taskId,
      parentTaskId,
      childTaskIds: [],
      createdBy: _role,
      createdNode: this.config.nodeId,
      status: 'created',
      vectorClock,
      priority,
    };

    this.crossNodeTasks.set(taskId, task);

    if (parentTaskId) {
      const parent = this.crossNodeTasks.get(parentTaskId);
      if (parent) {
        parent.childTaskIds.push(taskId);
      }
    }

    return task;
  }

  assignTask(taskId: string, agentId: string, nodeId: string): boolean {
    const task = this.crossNodeTasks.get(taskId);
    if (!task) return false;

    task.assignedTo = agentId;
    task.assignedNode = nodeId;
    task.status = 'assigned';

    this.vectorClock.tick();

    const scope = this.communicator.getTaskScope(taskId);
    if (!scope) {
      const agent = this.agentRegistry.get(agentId);
      if (agent) {
        this.communicator.createTaskScope(taskId, [agent], task.parentTaskId);
      }
    }

    return true;
  }

  createExecutionPlan(
    goal: string,
    roles: AgentRole[],
    priorities?: Record<AgentRole, TaskPriority>
  ): string[] {
    const nodeIds: string[] = [];
    const roleNodes = new Map<AgentRole, string[]>();
    const taskMap = new Map<string, CrossNodeTask>();

    for (const role of roles) {
      const roleType = getAgentType(role);
      const vectorClock = this.vectorClock.tick();

      const taskId = `task_${this.config.nodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const task: CrossNodeTask = {
        taskId,
        childTaskIds: [],
        createdBy: role,
        createdNode: this.config.nodeId,
        status: 'created',
        vectorClock,
        priority: priorities?.[role] || 'normal',
      };

      this.crossNodeTasks.set(taskId, task);
      taskMap.set(taskId, task);

      const nodeId = this.executionGraph.addNode(
        taskId,
        role,
        getDependencies(role).map(depRole => roleNodes.get(depRole)?.[0]).filter(Boolean) as string[],
        priorities?.[role] || 'normal',
        roleType.defaultTimeout,
        this.config.maxRetries,
        { goal, taskId }
      );
      nodeIds.push(nodeId);

      if (!roleNodes.has(role)) {
        roleNodes.set(role, []);
      }
      roleNodes.get(role)!.push(nodeId);
    }

    return nodeIds;
  }

  async execute(goal: string, projectId: string): Promise<DistributedOrchestrationResult> {
    this.executionStartTime = Date.now();
    this.abortController = new AbortController();

    this.logger.info('Starting distributed orchestration', {
      metadata: { goal, projectId, nodeId: this.config.nodeId },
    });

    const validation = this.executionGraph.validate();
    if (!validation.valid) {
      return {
        success: false,
        completedAgents: [],
        failedAgents: [],
        timedOutAgents: [],
        artifacts: {},
        executionTime: Date.now() - this.executionStartTime,
        errors: validation.errors,
        taskGraph: {},
        causalOrder: [],
      };
    }

    const schedule = this.executionGraph.computeExecutionSchedule();

    this.logger.info('Distributed execution plan computed', {
      metadata: {
        phases: schedule.phases.length,
        estimatedDuration: schedule.estimatedDuration,
        criticalPath: schedule.criticalPath.length,
        nodeId: this.config.nodeId,
      },
    });

    const completedAgents: string[] = [];
    const failedAgents: string[] = [];
    const timedOutAgents: string[] = [];
    const artifacts: Record<string, unknown> = {};
    const taskGraph: Record<string, string[]> = {};
    const causalOrder: VectorClockSnapshot[] = [];

    try {
      for (const phase of schedule.phases) {
        if (this.abortController?.signal.aborted) {
          this.logger.warn('Distributed orchestration aborted');
          break;
        }

        this.logger.info(`Starting distributed phase ${phase.phase}`, {
          metadata: {
            nodes: phase.nodes.map(n => n.role),
            canRunParallel: phase.canRunParallel,
            nodeId: this.config.nodeId,
          },
        });

        if (phase.canRunParallel) {
          const results = await this.executePhaseParallel(phase.nodes);

          for (const [nodeId, result] of results) {
            const node = this.executionGraph.getNode(nodeId);
            if (node) {
              const taskId = node.inputs?.taskId as string;
              const task = taskId ? this.crossNodeTasks.get(taskId) : undefined;

              if (result.success) {
                completedAgents.push(node.agentId || node.role);
                artifacts[node.taskId] = result.result;
                this.executionGraph.setNodeOutput(nodeId, { result: result.result });

                if (task) {
                  task.status = 'completed';
                  causalOrder.push(this.vectorClock.tick());
                }
              } else if (result.timeout) {
                timedOutAgents.push(node.agentId || node.role);
                if (task) task.status = 'failed';
              } else {
                failedAgents.push(node.agentId || node.role);
                if (task) task.status = 'failed';
              }

              if (taskId) {
                taskGraph[taskId] = completedAgents;
              }
            }
          }
        } else {
          for (const node of phase.nodes) {
            if (this.abortController?.signal.aborted) break;

            const result = await this.executeNode(node, projectId);
            const taskId = node.inputs?.taskId as string;
            const task = taskId ? this.crossNodeTasks.get(taskId) : undefined;

            if (result.success) {
              completedAgents.push(node.agentId || node.role);
              artifacts[node.taskId] = result.result;
              this.executionGraph.setNodeOutput(node.id, { result: result.result });
              if (task) {
                task.status = 'completed';
                causalOrder.push(this.vectorClock.tick());
              }
            } else if (result.timeout) {
              timedOutAgents.push(node.agentId || node.role);
              if (task) task.status = 'failed';
            } else {
              failedAgents.push(node.agentId || node.role);
              if (task) task.status = 'failed';
            }

            if (taskId) {
              taskGraph[taskId] = completedAgents;
            }
          }
        }

        await this.cleanupPhase();
      }
    } catch (error) {
      this.logger.error('Distributed orchestration error', { metadata: { error: String(error) } });
    }

    if (this.config.enableStateCleanup) {
      this.cleanupState();
    }

    const allSuccessful = failedAgents.length === 0 && timedOutAgents.length === 0;

    return {
      success: allSuccessful,
      completedAgents,
      failedAgents,
      timedOutAgents,
      artifacts,
      executionTime: Date.now() - this.executionStartTime,
      errors: failedAgents.map(id => `Agent ${id} failed`),
      taskGraph,
      causalOrder,
    };
  }

  private async executePhaseParallel(
    nodes: ExecutionNode[]
  ): Promise<Map<string, { success: boolean; result?: unknown; timeout?: boolean; error?: string }>> {
    const results = new Map<string, { success: boolean; result?: unknown; timeout?: boolean; error?: string }>();
    const limitedNodes = nodes.slice(0, this.config.maxConcurrentAgents);

    const promises = limitedNodes.map(async (node) => {
      const result = await this.executeNode(node, 'default');
      return { nodeId: node.id, result };
    });

    const settled = await Promise.allSettled(promises);

    for (const item of settled) {
      if (item.status === 'fulfilled') {
        results.set(item.value.nodeId, item.value.result);
      }
    }

    return results;
  }

  private async executeNode(
    node: ExecutionNode,
    projectId: string
  ): Promise<{ success: boolean; result?: unknown; timeout?: boolean; error?: string }> {
    const executor = this.executorRegistry.get(node.role);

    if (!executor) {
      return {
        success: false,
        error: `No executor registered for role: ${node.role}`,
      };
    }

    const agentIdentity = this.getAgentForRole(node.role);
    const taskId = node.inputs?.taskId as string || node.id;
    const vectorClock = this.vectorClock.tick();

    const execution: DistributedAgentExecution = {
      agentId: agentIdentity?.id || node.role,
      role: node.role,
      nodeId: this.config.nodeId,
      status: 'running',
      startTime: Date.now(),
      taskId,
      vectorClock,
    };

    this.activeExecutions.set(node.id, execution);
    this.executionGraph.updateNodeStatus(node.id, 'running');

    const scope = this.communicator.getTaskScope(taskId);
    if (!scope) {
      this.communicator.createTaskScope(taskId, agentIdentity ? [agentIdentity] : []);
    }

    try {
      const context = this.contextBuilder.buildContext(projectId, {
        agentRole: node.role,
        agentId: agentIdentity?.id || node.role,
        sessionId: taskId,
        commsGround: undefined,
      });

      execution.context = context;

      const result = await withTimeout(
        retry(
          async () => {
            this.logger.debug(`Executing distributed ${node.role}`, { metadata: { taskId, nodeId: this.config.nodeId } });
            return await executor(context, agentIdentity!, node, taskId, vectorClock);
          },
          {
            attempts: node.maxRetries,
            baseDelay: this.config.retryDelay,
          }
        ),
        node.timeout,
        `Agent ${node.role} execution`
      );

      this.executionGraph.updateNodeStatus(node.id, 'completed');
      execution.status = 'completed';
      execution.endTime = Date.now();
      execution.result = result;
      this.vectorClock.tick();

      return { success: true, result };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('timed out')) {
        this.executionGraph.updateNodeStatus(node.id, 'failed', 'Timeout');
        execution.status = 'timeout';
        execution.endTime = Date.now();
        execution.error = 'Execution timeout';

        if (this.config.abortOnTimeout) {
          this.abortController?.abort();
        }

        return { success: false, timeout: true, error: 'Execution timeout' };
      }

      if (node.retryCount < node.maxRetries) {
        node.retryCount++;
        this.logger.warn(`Agent ${node.role} failed, retrying (${node.retryCount}/${node.maxRetries})`);
        return this.executeNode(node, projectId);
      }

      this.executionGraph.updateNodeStatus(node.id, 'failed', errorMessage);
      execution.status = 'failed';
      execution.endTime = Date.now();
      execution.error = errorMessage;

      return { success: false, error: errorMessage };
    } finally {
      this.activeExecutions.set(node.id, execution);
    }
  }

  private getAgentForRole(role: AgentRole): DistributedAgentIdentity | undefined {
    for (const agent of this.agentRegistry.values()) {
      if (agent.role === role) {
        return agent;
      }
    }

    return {
      id: `${role}_${Date.now()}`,
      role,
      name: getAgentType(role).name,
      nodeId: this.config.nodeId,
    };
  }

  private notifyStateChange(): void {
    for (const listener of this.stateListeners) {
      try {
        listener(new Map(this.activeExecutions));
      } catch {
        // Ignore listener errors
      }
    }
  }

  onStateChange(listener: (state: Map<string, DistributedAgentExecution>) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      const idx = this.stateListeners.indexOf(listener);
      if (idx >= 0) {
        this.stateListeners.splice(idx, 1);
      }
    };
  }

  private async cleanupPhase(): Promise<void> {
    if (this.config.cleanupDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.config.cleanupDelay));
    }
  }

  private cleanupState(): void {
    for (const [nodeId, execution] of this.activeExecutions) {
      if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'timeout') {
        this.activeExecutions.delete(nodeId);
      }
    }

    this.distributedMemory.clear();

    for (const task of this.crossNodeTasks.values()) {
      this.commsGround.reset(task.taskId);
    }

    this.logger.debug('Distributed state cleanup completed');
  }

  createCollaborationLoop(taskId: string, participants: DistributedAgentIdentity[]): CollaborationLoop {
    const loopId = `loop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const loop: CollaborationLoop = {
      id: loopId,
      taskId,
      participants: participants.map(p => p.id),
      currentPhase: 'init',
      status: 'active',
      createdAt: Date.now(),
      lastSyncAt: Date.now(),
      rounds: 0,
    };

    this.collaborationLoops.set(loopId, loop);

    for (const participant of participants) {
      const scope = this.communicator.getTaskScope(taskId);
      if (!scope) {
        this.communicator.createTaskScope(taskId, [participant]);
      } else {
        this.communicator.joinTaskScope(taskId, participant);
      }
    }

    return loop;
  }

  private updateCollaborationLoop(loopId: string): void {
    const loop = this.collaborationLoops.get(loopId);
    if (!loop) return;

    loop.lastSyncAt = Date.now();
    loop.rounds++;
  }

  advanceCollaborationPhase(loopId: string, nextPhase: string): void {
    const loop = this.collaborationLoops.get(loopId);
    if (!loop || loop.status !== 'active') return;

    loop.currentPhase = nextPhase;
    this.vectorClock.tick();
  }

  completeCollaborationLoop(loopId: string): void {
    const loop = this.collaborationLoops.get(loopId);
    if (!loop) return;

    loop.status = 'completed';
  }

  pauseCollaborationLoop(loopId: string): void {
    const loop = this.collaborationLoops.get(loopId);
    if (!loop || loop.status !== 'active') return;

    loop.status = 'paused';
  }

  resumeCollaborationLoop(loopId: string): void {
    const loop = this.collaborationLoops.get(loopId);
    if (!loop || loop.status !== 'paused') return;

    loop.status = 'active';
    loop.lastSyncAt = Date.now();
  }

  getCollaborationLoops(): CollaborationLoop[] {
    return Array.from(this.collaborationLoops.values());
  }

  getActiveCollaborationLoop(taskId: string): CollaborationLoop | undefined {
    return Array.from(this.collaborationLoops.values()).find(
      loop => loop.taskId === taskId && loop.status === 'active'
    );
  }

  abort(): void {
    this.abortController?.abort();

    for (const [nodeId, execution] of this.activeExecutions) {
      if (execution.status === 'running') {
        execution.status = 'cancelled';
        execution.endTime = Date.now();
        this.executionGraph.updateNodeStatus(nodeId, 'cancelled');
      }
    }

    for (const loop of this.collaborationLoops.values()) {
      if (loop.status === 'active' || loop.status === 'paused') {
        loop.status = 'failed';
      }
    }

    this.logger.warn('Distributed orchestration aborted by user');
  }

  getActiveExecutions(): Map<string, DistributedAgentExecution> {
    return new Map(this.activeExecutions);
  }

  getCrossNodeTasks(): CrossNodeTask[] {
    return Array.from(this.crossNodeTasks.values());
  }

  getExecutionStats(): {
    total: number;
    active: number;
    completed: number;
    failed: number;
    timedOut: number;
    graphStats: ReturnType<ExecutionGraph['getStats']>;
    activeLoops: number;
    pendingTasks: number;
    vectorClock: string;
  } {
    const executions = Array.from(this.activeExecutions.values());

    return {
      total: executions.length,
      active: executions.filter(e => e.status === 'running').length,
      completed: executions.filter(e => e.status === 'completed').length,
      failed: executions.filter(e => e.status === 'failed').length,
      timedOut: executions.filter(e => e.status === 'timeout').length,
      graphStats: this.executionGraph.getStats(),
      activeLoops: Array.from(this.collaborationLoops.values()).filter(l => l.status === 'active').length,
      pendingTasks: this.crossNodeTasks.size,
      vectorClock: this.vectorClock.toString(),
    };
  }

  getExecutionGraph(): ExecutionGraph {
    return this.executionGraph;
  }

  getCommsGround(): DistributedCommsGround {
    return this.commsGround;
  }

  getDistributedMemory(): DistributedMemory {
    return this.distributedMemory;
  }

  getCommunicator(): DistributedAgentCommunicator {
    return this.communicator;
  }

  getVectorClock(): VectorClock {
    return this.vectorClock;
  }

  getNodeId(): string {
    return this.config.nodeId;
  }

  shutdown(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    this.abort();

    for (const loop of this.collaborationLoops.values()) {
      loop.status = 'failed';
    }

    this.emit('shutdown');
    this.removeAllListeners();
  }
}

let globalDistributedOrchestrator: DistributedOrchestrator | null = null;

export function initDistributedOrchestrator(
  config: DistributedOrchestratorConfig
): DistributedOrchestrator {
  globalDistributedOrchestrator = new DistributedOrchestrator(config);
  return globalDistributedOrchestrator;
}

export function getDistributedOrchestrator(): DistributedOrchestrator | null {
  return globalDistributedOrchestrator;
}
