import {
  TaskDAG,
  AgentTask,
  ContextSnapshot,
  OrchestrationEvent,
  DAGExecutionResult,
  MultiAgentConfig,
  DEFAULT_MULTI_AGENT_CONFIG,
  roleToContextKey,
} from './multi-agent-types.js';
import { ClassifiedError, FailureType } from './stateful-types.js';
import { TaskDecomposer } from './task-decomposer.js';
import { SharedContextRegistry } from './shared-context-registry.js';
import { DAGScheduler, TaskExecutor } from './dag-scheduler.js';
import { AgentExecutor, AgentExecutionInput } from './agent-executor.js';
import { MultiAgentGraphIntegrator } from './multi-agent-graph.js';
import { ExecutionGraph } from './graph-types.js';
import { DELErrorCode } from './types.js';

export interface OrchestratorConfig {
  multiAgent: MultiAgentConfig;
  workspaceRoot: string;
}

const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  multiAgent: DEFAULT_MULTI_AGENT_CONFIG,
  workspaceRoot: process.cwd(),
};

export interface OrchestratorResult {
  success: boolean;
  dagId: string;
  sessionId: string;
  result: DAGExecutionResult;
  executionGraph: ExecutionGraph;
  error?: string;
}

export class MultiAgentOrchestrator {
  private config: OrchestratorConfig;
  private decomposer: TaskDecomposer;
  private contextRegistry: SharedContextRegistry;
  private scheduler: DAGScheduler;
  private executor: AgentExecutor;
  private graphIntegrator: MultiAgentGraphIntegrator | null = null;
  private currentDAG: TaskDAG | null = null;

  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    this.decomposer = new TaskDecomposer(this.config.multiAgent);
    this.contextRegistry = new SharedContextRegistry();
    this.scheduler = new DAGScheduler({
      maxParallelAgents: this.config.multiAgent.maxParallelAgents,
      taskTimeoutMs: 120000,
      abortOnCriticalFailure: this.config.multiAgent.abortOnCriticalFailure,
    });
    this.executor = new AgentExecutor({
      delConfig: { workspaceRoot: this.config.workspaceRoot },
      enablePhase1Validation: true,
      timeoutMs: 120000,
    });
  }

  async execute(sessionId: string, goal: string): Promise<OrchestratorResult> {
    this.graphIntegrator = new MultiAgentGraphIntegrator(sessionId, goal);

    const eventUnsubscribe = this.scheduler.subscribe((event: OrchestrationEvent) => {
      this.graphIntegrator?.handleOrchestrationEvent(event);
    });

    const contextUnsubscribe = this.contextRegistry.subscribe((event: OrchestrationEvent) => {
      this.graphIntegrator?.handleOrchestrationEvent(event);
    });

    try {
      const decomposeResult = await this.decomposer.decompose(sessionId, goal);

      if (!decomposeResult.success || !decomposeResult.dag) {
        return {
          success: false,
          dagId: '',
          sessionId,
          result: this.createFailedResult(''),
          executionGraph: this.graphIntegrator.getGraph(),
          error: decomposeResult.error,
        };
      }

      const dag = decomposeResult.dag;
      this.currentDAG = dag;

      this.assignProviders(dag);

      this.contextRegistry.beginDAG(dag.id);

      const dagEvent: OrchestrationEvent = { type: 'DAG_CREATED', dag };
      this.graphIntegrator.handleOrchestrationEvent(dagEvent);
      this.graphIntegrator.initializeDAG(dag);

      const startTime = Date.now();

      const taskExecutor: TaskExecutor = async (task, snapshot): Promise<{ success: boolean; result?: unknown; error?: ClassifiedError }> => {
        return this.executeTask(task, snapshot as ContextSnapshot);
      };

      const getSnapshot = () => this.contextRegistry.getCurrentSnapshot();

      const scheduleResult = await this.scheduler.execute(dag, taskExecutor, getSnapshot);

      const finalContext = this.contextRegistry.getCurrentSnapshot();

      let finalStatus: DAGExecutionResult['status'] = 'completed';
      if (scheduleResult.failedTasks.length > 0) {
        finalStatus = scheduleResult.dag.status === 'failed' ? 'failed' : 'completed';
      }
      if (scheduleResult.cancelledTasks.length > scheduleResult.completedTasks.length) {
        finalStatus = 'cancelled';
      }

      const result: DAGExecutionResult = {
        dagId: dag.id,
        status: finalStatus,
        finalContext,
        completedTasks: scheduleResult.completedTasks,
        failedTasks: scheduleResult.failedTasks,
        cancelledTasks: scheduleResult.cancelledTasks,
        totalDurationMs: Date.now() - startTime,
      };

      const completionEvent: OrchestrationEvent = {
        type: finalStatus === 'completed' ? 'DAG_COMPLETED' : 'DAG_FAILED',
        dagId: dag.id,
        ...(finalStatus === 'completed' ? { finalContextVersion: finalContext.version } : { reason: 'Execution failed' }),
      } as OrchestrationEvent;
      this.graphIntegrator.handleOrchestrationEvent(completionEvent);

      this.contextRegistry.endDAG();

      return {
        success: finalStatus === 'completed',
        dagId: dag.id,
        sessionId,
        result,
        executionGraph: this.graphIntegrator.getGraph(),
      };
    } catch (error) {
      return {
        success: false,
        dagId: this.currentDAG?.id || '',
        sessionId,
        result: this.createFailedResult(this.currentDAG?.id || ''),
        executionGraph: this.graphIntegrator.getGraph(),
        error: error instanceof Error ? error.message : 'Unknown orchestrator error',
      };
    } finally {
      eventUnsubscribe();
      contextUnsubscribe();
    }
  }

  private assignProviders(dag: TaskDAG): void {
    for (const task of Object.values(dag.tasks)) {
      const definition = this.decomposer.getAgentDefinition(task.role);
      if (definition) {
        task.assignedProvider = definition.preferredProvider;
      }
    }
  }

  private async executeTask(task: AgentTask, snapshot: ContextSnapshot): Promise<{ success: boolean; result?: unknown; error?: ClassifiedError }> {
    const input: AgentExecutionInput = {
      task,
      snapshot,
      workspaceRoot: this.config.workspaceRoot,
    };

    const execResult = await this.executor.execute(input);

    if (execResult.success && execResult.validatedFiles) {
      const contextKey = task.outputContextKey || roleToContextKey(task.role);

      const commitResult = this.contextRegistry.commitMultiple(task.id, [
        { key: contextKey, value: execResult.validatedFiles },
        { key: `${contextKey}_raw`, value: execResult.result },
      ]);

      if (!commitResult.ok) {
        const error: ClassifiedError = {
          code: 'SCHEMA_MISMATCH' as DELErrorCode,
          message: `Context key ${commitResult.error.key} already exists`,
          context: task.id,
          stage: 'schema',
          failureType: 'schema_error' as FailureType,
          retryable: false,
          suggestedStrategy: 'abort',
        };
        return { success: false, error };
      }

      return {
        success: true,
        result: {
          files: execResult.validatedFiles,
          contextVersion: commitResult.value.version,
        },
      };
    }

    const fallbackError: ClassifiedError = {
      code: 'SYNTAX_ERROR' as DELErrorCode,
      message: execResult.error?.message || 'Unknown execution error',
      context: task.id,
      stage: 'content',
      failureType: (execResult.error?.failureType || 'content_error') as FailureType,
      retryable: execResult.error?.retryable ?? true,
      suggestedStrategy: execResult.error?.suggestedStrategy || 'retry_standard',
    };

    return {
      success: false,
      error: fallbackError,
    };
  }

  private createFailedResult(dagId: string): DAGExecutionResult {
    return {
      dagId,
      status: 'failed',
      finalContext: this.contextRegistry.getCurrentSnapshot(),
      completedTasks: [],
      failedTasks: [],
      cancelledTasks: [],
      totalDurationMs: 0,
    };
  }

  getCurrentDAG(): TaskDAG | null {
    return this.currentDAG;
  }

  getExecutionGraph(): ExecutionGraph | null {
    return this.graphIntegrator?.getGraph() || null;
  }

  getContextHistory(contextKey: string): Array<{ version: number; value: unknown; timestamp: number }> {
    return this.contextRegistry.getHistory(contextKey);
  }

  close(): void {
    this.contextRegistry.close();
  }
}

export function createMultiAgentOrchestrator(config?: Partial<OrchestratorConfig>): MultiAgentOrchestrator {
  return new MultiAgentOrchestrator(config);
}

export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
