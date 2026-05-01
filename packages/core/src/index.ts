import { nanoid } from 'nanoid';
import { Project, ProjectCreate, Task, TaskCreate, ProjectStatus } from './types.js';
import { initDatabase, DatabaseManager } from './db.js';
import { initWorkspace, Workspace } from './workspace.js';
import { initTaskManager, TaskManager } from './task-manager.js';
import { initEventBus, EventBus } from './event-bus.js';
import { initLogger, Logger } from './logger.js';
import { initProviderManager } from './providers/ProviderManager.js';
import { initAgentRegistry, getAgentRegistry } from './agent-registry.js';
import { initModelRouter } from './model-router.js';
import { initContextBuilder } from './context-builder.js';
import { initAgentRunner } from './agent-runner.js';
import type { AgentExecutionResult } from './agent-runner.js';
import { initOrchestrator, getOrchestrator } from './orchestrator/StrictOrchestrator.js';
import { loadConfig as loadConfigFromFile } from './config.js';
import { initBudgetTracker, getBudgetTracker } from './budget.js';
import { initCostTracker, getCostTracker } from './control/CostTracker.js';
import { initTemplateRegistry, TemplateEngine } from './templates/index.js';
import { FeedbackLoop } from './learning/FeedbackLoop.js';
import { getConfig } from './config.js';
import { ProfileManager, initProfileManager } from './auth/index.js';
import { KeyVault, initKeyVault } from './auth/key-vault.js';
import { TeamManager, initTeamManager } from './teams/manager.js';
import { WorkspaceSharing, initWorkspaceSharing } from './teams/sharing.js';
import { AuditLogger, initAuditLogger } from './audit/logger.js';
import { AuditReporter, initAuditReporter } from './audit/reporter.js';
import { ComplianceManager } from './audit/compliance.js';
import { RBAC } from './teams/rbac.js';
import { HealthMonitor, initHealthMonitor } from './agents/HealthMonitor.js';
import { SessionManager, initSessionManager } from './state/SessionManager.js';
export { ProfileManager, initProfileManager, getProfileManager } from './auth/index.js';
export { KeyVault, initKeyVault, getKeyVault } from './auth/key-vault.js';
export { TeamManager, initTeamManager, getTeamManager } from './teams/manager.js';
export { WorkspaceSharing, initWorkspaceSharing, getWorkspaceSharing } from './teams/sharing.js';
export { AuditLogger, initAuditLogger, getAuditLogger } from './audit/logger.js';
export { AuditReporter, initAuditReporter, getAuditReporter } from './audit/reporter.js';
export { ComplianceManager } from './audit/compliance.js';
export { RBAC } from './teams/rbac.js';
export { HealthMonitor, initHealthMonitor, getHealthMonitor } from './agents/HealthMonitor.js';
export type { HealthReport, AgentHealthState, HealthCheckResult } from './agents/HealthMonitor.js';
export { SessionManager, initSessionManager, getSessionManager } from './state/SessionManager.js';
export type { AppSession, SessionMessage, SessionContext } from './state/SessionManager.js';
export type { Role, Team, TeamMember, TeamInvite, SharedResource, ResourcePermissions, AuditEvent, PermissionRule } from './auth/types.js';
export { ROLE_PERMISSIONS } from './auth/types.js';

export class EamilOS {
  private db: DatabaseManager;
  private workspace: Workspace;
  private taskManager: TaskManager;
  private eventBus: EventBus;
  private logger: Logger;
  private instanceId: string;
  private initialized: boolean = false;
  private feedbackLoop: FeedbackLoop | null = null;
  private templateEngine: TemplateEngine | null = null;
  private profileManager: ProfileManager;
  private keyVault: KeyVault;
  private teamManager: TeamManager;
  private workspaceSharing: WorkspaceSharing;
  private auditLogger: AuditLogger;
  private auditReporter: AuditReporter;
  private complianceManager: ComplianceManager;
  private healthMonitor: HealthMonitor;
  private sessionManager: SessionManager;

  constructor() {
    this.instanceId = nanoid(8);
    this.db = initDatabase();
    this.workspace = initWorkspace();
    this.taskManager = initTaskManager(this.db);
    this.eventBus = initEventBus(this.db);
    this.logger = initLogger();
    this.profileManager = initProfileManager();
    this.keyVault = initKeyVault();
    this.teamManager = initTeamManager();
    this.workspaceSharing = initWorkspaceSharing();
    this.auditLogger = initAuditLogger();
    this.auditReporter = initAuditReporter(this.auditLogger);
    this.complianceManager = new ComplianceManager(
      this.auditLogger,
      this.profileManager,
      this.keyVault,
      this.teamManager,
    );
    this.healthMonitor = initHealthMonitor();

    const profileId = (() => {
      try {
        return this.profileManager.getActiveProfile()?.id || 'default';
      } catch {
        return 'default';
      }
    })();
    this.sessionManager = initSessionManager(profileId);
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

    const budgetConfig = getConfig().budget;
    const dailyBudget = budgetConfig.max_cost_per_project_usd || 10;
    initBudgetTracker();
    initCostTracker(dailyBudget);
    initTemplateRegistry();

    this.feedbackLoop = new FeedbackLoop({
      storagePath: '.eamilos/learning',
      enableAutoApply: true,
      maxAutoApplyDuration: 30 * 60 * 1000,
      minConfidenceForAutoApply: 0.7,
      enableCausalAttribution: true,
      enableStaggeredUpdates: true,
      enableInteractionMatrix: true,
    });
    await this.feedbackLoop.initialize();

    this.templateEngine = new TemplateEngine();

    const registry = getAgentRegistry();
    const registered = await registry.autoRegisterFromDiscovery();
    if (registered > 0) {
      this.logger.info(`Auto-discovered ${registered} agents`);
    }

    await this.recoverCrashedProjects();

    this.healthMonitor.start();
    this.logger.info('Health monitoring started');

    await this.sessionManager.initialize();
    const restored = await this.sessionManager.restore();
    if (restored) {
      this.logger.info('Session restored from previous run');
    }
    this.sessionManager.startAutoSave(30000);

    this.healthMonitor.on('agent:health-degraded', (data: any) => {
      const profileId = this.getActiveProfileId();
      if (profileId) {
        this.auditLogger.log(
          profileId,
          'security',
          'agent_degraded',
          { agentId: data.agentId, failures: data.failures, score: data.score },
          'failure',
        );
      }
    });

    this.healthMonitor.on('agent:failover', (data: any) => {
      this.logger.info(`Failover: ${data.from} -> ${data.to} (${data.tasksTransferred} tasks)`);
      const profileId = this.getActiveProfileId();
      if (profileId) {
        this.auditLogger.log(
          profileId,
          'security',
          'agent_failover',
          { from: data.from, to: data.to, tasksTransferred: data.tasksTransferred },
        );
      }
    });

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

  getTemplateEngine(): TemplateEngine | null {
    return this.templateEngine;
  }

  getFeedbackLoop(): FeedbackLoop | null {
    return this.feedbackLoop;
  }

  getCostSnapshot() {
    const costTracker = getCostTracker();
    const budgetTracker = getBudgetTracker();
    return {
      cost: costTracker?.getSnapshot() ?? null,
      budget: budgetTracker.check('default'),
    };
  }

  getProfileManager(): ProfileManager {
    return this.profileManager;
  }

  getKeyVault(): KeyVault {
    return this.keyVault;
  }

  getTeamManager(): TeamManager {
    return this.teamManager;
  }

  getWorkspaceSharing(): WorkspaceSharing {
    return this.workspaceSharing;
  }

  getAuditLogger(): AuditLogger {
    return this.auditLogger;
  }

  getAuditReporter(): AuditReporter {
    return this.auditReporter;
  }

  getComplianceManager(): ComplianceManager {
    return this.complianceManager;
  }

  checkPermission(role: string, action: string): boolean {
    return RBAC.hasPermission(role as any, action);
  }

  getHealthMonitor(): HealthMonitor {
    return this.healthMonitor;
  }

  getHealthReport() {
    return this.healthMonitor.getHealthReport();
  }

  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  async saveSession(sessionId?: string): Promise<string> {
    return this.sessionManager.save(sessionId);
  }

  async listSessions(): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
    return this.sessionManager.list();
  }

  async createSession(name: string): Promise<string> {
    return this.sessionManager.create(name);
  }

  async loadSession(sessionId: string): Promise<boolean> {
    return this.sessionManager.restore(sessionId);
  }

  private getActiveProfileId(): string | null {
    try {
      const profile = this.profileManager.getActiveProfile();
      return profile?.id || null;
    } catch {
      return null;
    }
  }

  shutdown(): void {
    this.logger.info('Shutting down EamilOS');
    this.sessionManager.stopAutoSave();
    this.sessionManager.save().catch(() => {});
    this.healthMonitor.stop();
    this.feedbackLoop?.shutdown();
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
export { autoDiscovery, AutoDiscovery, type DiscoveredAgent, type DiscoveryResult } from './auto-discovery.js';
export { YAMLLoader, initYamlLoader, getYamlLoader } from './discovery/YAMLLoader.js';
export { HealthValidator, type ValidationResult } from './discovery/HealthValidator.js';
export * from './templates/index.js';
export { BudgetTracker, initBudgetTracker, getBudgetTracker } from './budget.js';
export { CostTracker, initCostTracker, getCostTracker } from './control/CostTracker.js';
