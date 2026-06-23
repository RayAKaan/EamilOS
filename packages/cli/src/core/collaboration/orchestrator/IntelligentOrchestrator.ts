import type { AgentRole } from '../AgentType.js';
import { getAgentType, getDependencies } from '../AgentType.js';
import { ExecutionGraph, type ExecutionNode, type TaskPriority } from '../ExecutionGraph.js';
import { CommsGround } from '../CommsGround.js';
import { SharedMemory } from '../../memory/SharedMemory.js';
import { AgentCommunicator, type AgentIdentity } from '../AgentCommunicator.js';
import { ContextBuilder, type BuiltContext } from '../ContextBuilder.js';
import { withTimeout } from '../../utils/withTimeout.js';
import { retry } from '../../utils/retry.js';
import { getLogger, type Logger } from '../../logger.js';

export interface IntelligentOrchestratorConfig {
  maxConcurrentAgents: number;
  defaultTimeout: number;
  maxRetries: number;
  retryDelay: number;
  enableStateCleanup: boolean;
  abortOnTimeout: boolean;
  cleanupDelay: number;
}

const DEFAULT_CONFIG: IntelligentOrchestratorConfig = {
  maxConcurrentAgents: 3,
  defaultTimeout: 120000,
  maxRetries: 3,
  retryDelay: 1000,
  enableStateCleanup: true,
  abortOnTimeout: true,
  cleanupDelay: 500,
};

export interface AgentExecution {
  agentId: string;
  role: AgentRole;
  nodeId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled';
  startTime?: number;
  endTime?: number;
  result?: unknown;
  error?: string;
  context?: BuiltContext;
}

export interface OrchestrationResult {
  success: boolean;
  completedAgents: string[];
  failedAgents: string[];
  timedOutAgents: string[];
  artifacts: Record<string, unknown>;
  executionTime: number;
  errors: string[];
}

export interface AgentExecutor {
  (context: BuiltContext, agent: AgentIdentity, node: ExecutionNode): Promise<unknown>;
}

export class IntelligentOrchestrator {
  private config: IntelligentOrchestratorConfig;
  private executionGraph: ExecutionGraph;
  private commsGround: CommsGround;
  private sharedMemory: SharedMemory;
  private communicator: AgentCommunicator;
  private contextBuilder: ContextBuilder;
  private logger: Logger;
  private activeExecutions: Map<string, AgentExecution> = new Map();
  private agentRegistry: Map<string, AgentIdentity> = new Map();
  private executorRegistry: Map<AgentRole, AgentExecutor> = new Map();
  private stateListeners: Array<(state: Map<string, AgentExecution>) => void> = [];
  private abortController: AbortController | null = null;
  private executionStartTime: number = 0;

  constructor(config: Partial<IntelligentOrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.executionGraph = new ExecutionGraph({
      maxConcurrentTasks: this.config.maxConcurrentAgents,
      defaultTimeout: this.config.defaultTimeout,
      defaultMaxRetries: this.config.maxRetries,
    });
    this.commsGround = new CommsGround();
    this.sharedMemory = new SharedMemory();
    this.communicator = new AgentCommunicator(this.commsGround, this.sharedMemory);
    this.contextBuilder = new ContextBuilder();
    this.logger = getLogger();

    this.setupStateListeners();
  }

  registerExecutor(role: AgentRole, executor: AgentExecutor): void {
    this.executorRegistry.set(role, executor);
  }

  registerAgent(identity: AgentIdentity): void {
    this.agentRegistry.set(identity.id, identity);
  }

  createExecutionPlan(
    goal: string,
    roles: AgentRole[],
    priorities?: Record<AgentRole, TaskPriority>
  ): string[] {
    const nodeIds: string[] = [];
    const roleNodes = new Map<AgentRole, string[]>();

    for (const role of roles) {
      const roleType = getAgentType(role);
      const nodeId = this.executionGraph.addNode(
        `${role}_${Date.now()}`,
        role,
        getDependencies(role).map(depRole => roleNodes.get(depRole)?.[0]).filter(Boolean) as string[],
        priorities?.[role] || 'normal',
        roleType.defaultTimeout,
        this.config.maxRetries,
        { goal }
      );
      nodeIds.push(nodeId);

      if (!roleNodes.has(role)) {
        roleNodes.set(role, []);
      }
      roleNodes.get(role)!.push(nodeId);
    }

    return nodeIds;
  }

  async execute(goal: string, projectId: string): Promise<OrchestrationResult> {
    this.executionStartTime = Date.now();
    this.abortController = new AbortController();

    this.logger.info('Starting intelligent orchestration', { metadata: { goal, projectId } });

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
      };
    }

    const schedule = this.executionGraph.computeExecutionSchedule();

    this.logger.info('Execution plan computed', {
      metadata: {
        phases: schedule.phases.length,
        estimatedDuration: schedule.estimatedDuration,
        criticalPath: schedule.criticalPath.length,
      },
    });

    const completedAgents: string[] = [];
    const failedAgents: string[] = [];
    const timedOutAgents: string[] = [];
    const artifacts: Record<string, unknown> = {};

    try {
      for (const phase of schedule.phases) {
        if (this.abortController?.signal.aborted) {
          this.logger.warn('Orchestration aborted');
          break;
        }

        this.logger.info(`Starting phase ${phase.phase}`, {
          metadata: {
            nodes: phase.nodes.map(n => n.role),
            canRunParallel: phase.canRunParallel,
          },
        });

        if (phase.canRunParallel) {
          const results = await this.executePhaseParallel(phase.nodes);

          for (const [nodeId, result] of results) {
            const node = this.executionGraph.getNode(nodeId);
            if (node) {
              if (result.success) {
                completedAgents.push(node.agentId || node.role);
                artifacts[node.taskId] = result.result;
                this.executionGraph.setNodeOutput(nodeId, { result: result.result });
              } else if (result.timeout) {
                timedOutAgents.push(node.agentId || node.role);
              } else {
                failedAgents.push(node.agentId || node.role);
              }
            }
          }
        } else {
          for (const node of phase.nodes) {
            if (this.abortController?.signal.aborted) break;

            const result = await this.executeNode(node, projectId);

            if (result.success) {
              completedAgents.push(node.agentId || node.role);
              artifacts[node.taskId] = result.result;
              this.executionGraph.setNodeOutput(node.id, { result: result.result });
            } else if (result.timeout) {
              timedOutAgents.push(node.agentId || node.role);
            } else {
              failedAgents.push(node.agentId || node.role);
            }
          }
        }

        await this.cleanupPhase();
      }
    } catch (error) {
      this.logger.error('Orchestration error', { metadata: { error: String(error) } });
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
    };
  }

  private async executePhaseParallel(nodes: ExecutionNode[]): Promise<Map<string, { success: boolean; result?: unknown; timeout?: boolean; error?: string }>> {
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

    const execution: AgentExecution = {
      agentId: agentIdentity?.id || node.role,
      role: node.role,
      nodeId: node.id,
      status: 'running',
      startTime: Date.now(),
    };

    this.activeExecutions.set(node.id, execution);
    this.executionGraph.updateNodeStatus(node.id, 'running');

    try {
      const context = this.contextBuilder.buildContext(projectId, {
        agentRole: node.role,
        agentId: agentIdentity?.id || node.role,
        sessionId: this.communicator.createScope(projectId, agentIdentity ? [agentIdentity] : []).sessionId,
        commsGround: this.commsGround,
      });

      execution.context = context;

      const result = await withTimeout(
        retry(
          async () => {
            this.logger.debug(`Executing ${node.role}`);
            return await executor(context, agentIdentity!, node);
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

  private getAgentForRole(role: AgentRole): AgentIdentity | undefined {
    for (const agent of this.agentRegistry.values()) {
      if (agent.role === role) {
        return agent;
      }
    }

    return {
      id: `${role}_${Date.now()}`,
      role,
      name: getAgentType(role).name,
    };
  }

  private setupStateListeners(): void {
    this.executionGraph.onStatusChange(() => {
      this.notifyStateChange();
    });
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

  onStateChange(listener: (state: Map<string, AgentExecution>) => void): () => void {
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

    this.sharedMemory.clear();

    const oldMessages = Date.now() - 3600000;
    this.commsGround.clear(oldMessages);

    this.logger.debug('State cleanup completed');
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

    this.logger.warn('Orchestration aborted by user');
  }

  getActiveExecutions(): Map<string, AgentExecution> {
    return new Map(this.activeExecutions);
  }

  getExecutionStats(): {
    total: number;
    active: number;
    completed: number;
    failed: number;
    timedOut: number;
    graphStats: ReturnType<ExecutionGraph['getStats']>;
  } {
    const executions = Array.from(this.activeExecutions.values());

    return {
      total: executions.length,
      active: executions.filter(e => e.status === 'running').length,
      completed: executions.filter(e => e.status === 'completed').length,
      failed: executions.filter(e => e.status === 'failed').length,
      timedOut: executions.filter(e => e.status === 'timeout').length,
      graphStats: this.executionGraph.getStats(),
    };
  }

  getExecutionGraph(): ExecutionGraph {
    return this.executionGraph;
  }

  getCommsGround(): CommsGround {
    return this.commsGround;
  }

  getSharedMemory(): SharedMemory {
    return this.sharedMemory;
  }

  getCommunicator(): AgentCommunicator {
    return this.communicator;
  }
}

let globalOrchestrator: IntelligentOrchestrator | null = null;

export function initIntelligentOrchestrator(
  config?: Partial<IntelligentOrchestratorConfig>
): IntelligentOrchestrator {
  globalOrchestrator = new IntelligentOrchestrator(config);
  return globalOrchestrator;
}

export function getIntelligentOrchestrator(): IntelligentOrchestrator {
  if (!globalOrchestrator) {
    return initIntelligentOrchestrator();
  }
  return globalOrchestrator;
}
