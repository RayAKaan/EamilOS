import { nanoid } from 'nanoid';
import { Project, ProjectCreate, Task, TaskCreate, ProjectStatus } from './types.js';
import { initDatabase, DatabaseManager } from './db.js';
import { initWorkspace, Workspace } from './workspace.js';
import { initTaskManager, TaskManager } from './task-manager.js';
import { initEventBus, EventBus } from './event-bus.js';
import { initLogger, Logger } from './logger.js';
import { initProviderManager } from './providers/ProviderManager.js';
import { initAgentRegistry } from './agent-registry.js';
import { initModelRouter } from './model-router.js';
import { initContextBuilder } from './context-builder.js';
import { initAgentRunner } from './agent-runner.js';
import type { AgentExecutionResult } from './agent-runner.js';
import { initOrchestrator, getOrchestrator } from './orchestrator/StrictOrchestrator.js';
import { loadConfig as loadConfigFromFile } from './config.js';

export class EamilOS {
  private db: DatabaseManager;
  private workspace: Workspace;
  private taskManager: TaskManager;
  private eventBus: EventBus;
  private logger: Logger;
  private instanceId: string;
  private initialized: boolean = false;

  constructor() {
    this.instanceId = nanoid(8);
    this.db = initDatabase();
    this.workspace = initWorkspace();
    this.taskManager = initTaskManager(this.db);
    this.eventBus = initEventBus(this.db);
    this.logger = initLogger();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.logger.info(`Initializing EamilOS (instance: ${this.instanceId})`);
    initProviderManager();
    initAgentRegistry();
    initModelRouter();
    initContextBuilder();
    initAgentRunner();
    initOrchestrator({ maxRetries: 3 });

    await this.recoverCrashedProjects();

    this.initialized = true;
    this.logger.success('EamilOS initialized');
  }

  async executeTask(taskId: string): Promise<AgentExecutionResult> {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const project = this.getProject(task.projectId);
    if (!project) {
      throw new Error(`Project not found: ${task.projectId}`);
    }

    this.logger.info(`Executing task: ${task.title}`);
    this.taskManager.updateTaskStatus(taskId, 'in_progress');

    const orchestrator = getOrchestrator();
    const orchestratorResult = await orchestrator.execute(project.goal, project.id);

    const result: AgentExecutionResult = {
      success: orchestratorResult.success,
      taskId: taskId,
      artifacts: orchestratorResult.artifacts,
      output: orchestratorResult.files?.map(f => `${f.path}: ${f.content.length} chars`).join(', ') || '',
      toolCalls: orchestratorResult.attempts,
      error: orchestratorResult.success ? undefined : orchestratorResult.failureReasons.join('; '),
    };

    if (result.success) {
      this.taskManager.updateTaskStatus(taskId, 'completed');
      
      for (const artifact of result.artifacts) {
        this.db.insertArtifact({
          projectId: project.id,
          taskId: task.id,
          path: artifact,
          content: '',
          hash: this.workspace.computeHash(''),
          size: 0,
          type: artifact.endsWith('.py') ? 'code' : 'other',
          createdBy: 'agent',
        });
      }
    } else {
      this.taskManager.updateTaskStatus(taskId, 'failed');
      this.taskManager.setTaskError(taskId, result.error || 'Unknown error');
    }

    this.eventBus.emitSync({
      type: result.success ? 'task.completed' : 'task.failed',
      projectId: project.id,
      taskId: task.id,
      data: { artifacts: result.artifacts, error: result.error },
    });

    return result;
  }

  private async recoverCrashedProjects(): Promise<void> {
    const projects = this.db.getAllProjects().filter((p) => p.status === 'active');

    for (const project of projects) {
      const tasks = this.taskManager.getProjectTasks(project.id);
      const inProgress = tasks.filter((t) => t.status === 'in_progress');

      if (inProgress.length > 0) {
        this.logger.warn(`Recovering ${inProgress.length} stuck tasks in project ${project.id}`);
        
        for (const task of inProgress) {
          try {
            this.taskManager.updateTaskStatus(task.id, 'interrupted');
            this.taskManager.unlockTask(task.id);
          } catch (error) {
            this.logger.error(`Failed to recover task ${task.id}:`, { taskId: task.id });
          }
        }

        this.eventBus.emitSync({
          type: 'system.recovery',
          projectId: project.id,
          data: { recoveredTasks: inProgress.map((t) => t.id) },
          humanReadable: `Recovered ${inProgress.length} stuck tasks`,
        });
      }
    }
  }

  async createProject(data: ProjectCreate): Promise<Project> {
    const project = this.db.createProject(data);
    this.workspace.createProjectDir(project.id);
    await this.workspace.initGit(project.id);

    this.eventBus.emitSync({
      type: 'project.created',
      projectId: project.id,
      data: { name: project.name, goal: project.goal },
      humanReadable: `Created project: ${project.name}`,
    });

    this.logger.project(project.id, `Created project: ${project.name}`);

    return project;
  }

  getProject(id: string): Project | null {
    return this.db.getProject(id);
  }

  getAllProjects(): Project[] {
    return this.db.getAllProjects();
  }

  async createTask(data: TaskCreate): Promise<Task> {
    const task = this.taskManager.createTask(data);

    this.eventBus.emitSync({
      type: 'task.created',
      projectId: task.projectId,
      taskId: task.id,
      data: { title: task.title, type: task.type },
      humanReadable: `Created task: ${task.title}`,
    });

    return task;
  }

  getTask(id: string): Task | null {
    return this.taskManager.getTask(id);
  }

  getProjectTasks(projectId: string): Task[] {
    return this.taskManager.getProjectTasks(projectId);
  }

  getReadyTasks(projectId: string): Task[] {
    return this.taskManager.getReadyTasks(projectId);
  }

  getProjectStatus(projectId: string) {
    return this.taskManager.getProjectStatus(projectId);
  }

  async completeProject(projectId: string): Promise<void> {
    this.db.updateProjectStatus(projectId, 'completed' as ProjectStatus, new Date());
    this.eventBus.emitSync({
      type: 'project.completed',
      projectId,
      humanReadable: 'Project completed',
    });
  }

  async pauseProject(projectId: string): Promise<void> {
    this.db.updateProjectStatus(projectId, 'paused' as ProjectStatus);
    this.eventBus.emitSync({
      type: 'project.paused',
      projectId,
      humanReadable: 'Project paused',
    });
  }

  async resumeProject(projectId: string): Promise<void> {
    this.db.updateProjectStatus(projectId, 'active' as ProjectStatus);
    this.eventBus.emitSync({
      type: 'project.resumed',
      projectId,
      humanReadable: 'Project resumed',
    });
  }

  async cancelProject(projectId: string): Promise<void> {
    this.taskManager.cancelProjectTasks(projectId);
    this.db.updateProjectStatus(projectId, 'cancelled' as ProjectStatus);
    this.eventBus.emitSync({
      type: 'project.cancelled',
      projectId,
      humanReadable: 'Project cancelled',
    });
  }

  retryFailedTasks(projectId: string): number {
    return this.taskManager.resetFailedTasks(projectId);
  }

  getProjectEvents(projectId: string, limit?: number) {
    return this.db.getProjectEvents(projectId, limit);
  }

  getDecisionEvents(projectId: string) {
    return this.db.getDecisionEvents(projectId);
  }

  writeArtifact(projectId: string, filePath: string, content: string): void {
    this.workspace.writeArtifact(projectId, filePath, content);
  }

  readArtifact(projectId: string, filePath: string): string {
    return this.workspace.readArtifact(projectId, filePath);
  }

  listArtifacts(projectId: string) {
    return this.workspace.listFiles(projectId);
  }

  shutdown(): void {
    this.logger.info('Shutting down EamilOS');
    this.db.close();
  }
}

let globalInstance: EamilOS | null = null;

export async function initEamilOS(): Promise<EamilOS> {
  if (globalInstance) {
    return globalInstance;
  }
  await loadConfigFromFile();
  globalInstance = new EamilOS();
  await globalInstance.initialize();
  return globalInstance;
}

export function getEamilOS(): EamilOS {
  if (!globalInstance) {
    throw new Error('EamilOS not initialized. Call initEamilOS() first.');
  }
  return globalInstance;
}

export * from './tools/index.js';
export * from './validation/index.js';
export * from './utils/index.js';
export * from './errors.js';
export * from './error-handler.js';
export * as DEL from './del/index.js';
export { DELExecutor, createDELExecutor, executeDEL } from './del/executor.js';
export type { ExecutionContext, ExecutionResult } from './del/executor.js';
export type { ExecutionCallbacks, Session, FileResult, WALEntry } from './del/stateful-types.js';
export { initAgentRegistry, getAgentRegistry } from './agent-registry.js';
export * from './models/ModelDiscovery.js';
export * from './models/SmartModelSelector.js';
export * from './diagnostics/ExplainableError.js';
export { ErrorHumanizer, humanizeError, formatError } from './diagnostics/ErrorHumanizer.js';
export * from './diagnostics/index.js';
export * from './security/SecurityAudit.js';
export * from './security/index.js';
export * from './config.js';
export { loadConfig as loadConfigFromFile } from './config.js';
export * from './config/ConfigNormalizer.js';
export * from './config/ConfigWriter.js';
export * from './config/ProviderRegistry.js';
export * from './config/AutoInit.js';
export * from './config/ConfigHealer.js';
export * from './providers/OllamaDetector.js';
export * from './providers/ProviderReadiness.js';
export * from './providers/ExecutionGuarantee.js';
export * from './plugins/index.js';
export * from './cli/index.js';
export * from './features/index.js';
export { Logger, initLogger, getLogger } from './logger.js';
export { formatError as formatEamilOSError } from './error-handler.js';
export * from './distributed/index.js';
export { FeedbackLoop, type FeedbackLoopConfig, type LearningInsights, type LearningConfigState } from './learning/FeedbackLoop.js';
export { AutoTuner, type AutoTunerConfig } from './learning/AutoTuner.js';
export { ExecutionMemory } from './learning/ExecutionMemory.js';
export { ModelPerformance } from './learning/ModelPerformance.js';
export { SmartModelRouter, type RouterConfig } from './learning/SmartModelRouter.js';
export { StrategyOptimizer, type StrategyConfig } from './learning/StrategyOptimizer.js';
export { PromptOptimizer, type PromptOptimizerConfig } from './learning/PromptOptimizer.js';
export { FailureAnalyzer, type FailureAnalyzerConfig } from './learning/FailureAnalyzer.js';
export { EnrichmentLibrary } from './learning/EnrichmentLibrary.js';
export * from './learning/statistics.js';
export * from './execution/index.js';
export { TerminalOrchestrator } from './execution/TerminalOrchestrator.js';
export { CommsGround, initCommsGround, getCommsGround } from './collaboration/CommsGround.js';
export { CLIAdapter, ClaudeCLIAdapter, CodexCLIAdapter } from './agents/cli-adapters/index.js';
export { CLIAgentRunner } from './agents/AgentRunner.js';
export { Observability } from './telemetry/Observability.js';
export { HealthEndpoint } from './telemetry/HealthEndpoint.js';
export { CircuitBreaker, ResourceLimiter } from './resilience/index.js';
export { SecurityManager } from './security/SecurityManager.js';
export { ConnectionPool } from './performance/ConnectionPool.js';
export { runHealthCheck } from './health.js';
