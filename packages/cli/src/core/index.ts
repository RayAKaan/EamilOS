import { nanoid } from 'nanoid';
import { Project, ProjectCreate, Task, TaskCreate, ProjectStatus } from './types.js';
import { initDatabase, DatabaseManager } from './db.js';
import { initWorkspace, Workspace } from './workspace.js';
import { initTaskManager, TaskManager } from './task-manager.js';
import { initEventBus, EventBus } from './event-bus.js';
import { initLogger, Logger } from './logger.js';
import type { AgentExecutionResult } from './agent-runner.js';
import { getOrchestrator } from './orchestrator/StrictOrchestrator.js';
import { loadConfig as loadConfigFromFile } from './config.js';

export class EamilOS {
  private _db: DatabaseManager | null = null;
  private _workspace: Workspace | null = null;
  private _taskManager: TaskManager | null = null;
  private _eventBus: EventBus | null = null;
  private logger: Logger;
  readonly instanceId: string;

  constructor() {
    this.instanceId = nanoid(8);
    this.logger = initLogger();
    this.logger.info(`EamilOS ${this.instanceId} ready (lazy init)`);
  }

  private ensureDb(): DatabaseManager {
    if (!this._db) {
      this._db = initDatabase();
      this._taskManager = initTaskManager(this._db);
      this._eventBus = initEventBus(this._db);
    }
    return this._db;
  }

  private ensureWorkspace(): Workspace {
    if (!this._workspace) {
      this._workspace = initWorkspace();
    }
    return this._workspace;
  }

  private get db(): DatabaseManager { return this.ensureDb(); }
  private get workspace(): Workspace { return this.ensureWorkspace(); }
  private get taskManager(): TaskManager { this.ensureDb(); return this._taskManager!; }
  private get eventBus(): EventBus { this.ensureDb(); return this._eventBus!; }

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
    if (this._db) this._db.close();
  }
}

let globalInstance: EamilOS | null = null;

export async function initEamilOS(): Promise<EamilOS> {
  if (globalInstance) return globalInstance;
  await loadConfigFromFile();
  globalInstance = new EamilOS();
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
export * from './agents/index.js';
export * from './session/index.js';
export * from './policy/index.js';
export * from './workspace/index.js';
export * from './terminal/index.js';
export * from './changes/index.js';
export * from './distributed/index.js';
export { buildAgentEnv, buildSafeEnv } from './security/AgentEnv.js';
export { validateChanges, validateFileChange } from './validation/ChangeValidationPipeline.js';
export { planTask, suggestExecutionStrategy } from './planning/TaskPlanner.js';
export type { TaskPlan, Subtask } from './planning/TaskPlanner.js';
export { routeTask } from './routing/AgentRouter.js';
export type { RoutingDecision, Assignment, RouterInput } from './routing/AgentRouter.js';
export { classifyAgentError, isRetryable, isFallbackTrigger } from './agents/AgentErrorClassifier.js';
export { getSystemPrompt, getPlannerPrompt } from './prompts/AgentPromptRegistry.js';
export type { PromptRole, PromptKey } from './prompts/AgentPromptRegistry.js';
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
export { CallsignRegistry } from './identity/CallsignRegistry.js';
export { ConflictArbiter } from './comms/ConflictArbiter.js';
export {
  AdaptiveMultiplexer,
  getAdaptiveMultiplexer,
  ConstraintEnforcer,
  getConstraintEnforcer,
  ConstraintError,
  type AgentOperationalMode,
  type MultiplexedAgentTerminal,
  type TerminalEnvironment,
  type AgentTerminalDef,
} from '../terminal/index.js';
