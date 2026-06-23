// PHASE STABILIZATION: Enhanced orchestrator with retry/validation
import { Project, Task, TaskResult } from './types.js';
import { getLogger } from './logger.js';
import { getEventBus } from './event-bus.js';
import { getRetryStrategy } from './retry-strategy.js';
import { parseResponse } from './parsers/ResponseParser.js';

export interface OrchestratorOptions {
  maxParallel?: number;
  onTaskStart?: (task: Task) => void;
  onTaskComplete?: (result: TaskResult) => void;
  onTaskFail?: (task: Task, error: Error) => void;
  maxRetries?: number;
}

export interface ExecutionAttempt {
  attemptNumber: number;
  success: boolean;
  artifacts: string[];
  error?: string;
  timestamp: Date;
}

export interface TaskExecutionContext {
  task: Task;
  attempts: ExecutionAttempt[];
  currentPrompt: string;
}

export class Orchestrator {
  private options: OrchestratorOptions;
  private running: boolean = false;
  private activeTasks: Map<string, TaskExecutionContext> = new Map();

  constructor(options: OrchestratorOptions = {}) {
    this.options = {
      maxParallel: options.maxParallel ?? 3,
      maxRetries: options.maxRetries ?? 3,
      ...options,
    };
  }

  async run(project: Project, tasks: Task[]): Promise<void> {
    const logger = getLogger();
    logger.info(`Starting orchestration for project ${project.id} with ${tasks.length} tasks`);

    this.running = true;

    while (this.running) {
      const readyTasks = tasks.filter(
        (t) =>
          (t.status === 'ready' || t.status === 'pending') &&
          !this.activeTasks.has(t.id) &&
          this.canRun(t, tasks)
      );

      if (readyTasks.length === 0 && this.activeTasks.size === 0) {
        break;
      }

      const maxConcurrent = this.options.maxParallel ?? 3;
      const slotsAvailable = maxConcurrent - this.activeTasks.size;
      const toStart = readyTasks.slice(0, slotsAvailable);

      for (const task of toStart) {
        const context: TaskExecutionContext = {
          task,
          attempts: [],
          currentPrompt: task.description || task.title,
        };
        this.activeTasks.set(task.id, context);
        this.executeTaskWithRetry(task, context).catch((error) => {
          logger.error(`Task ${task.id} failed:`, error);
          this.activeTasks.delete(task.id);
        });
      }

      await this.sleep(100);
    }

    logger.info(`Orchestration complete for project ${project.id}`);
  }

  private canRun(task: Task, allTasks: Task[]): boolean {
    if (!task.dependsOn || task.dependsOn.length === 0) {
      return true;
    }

    const completedIds = new Set(
      allTasks.filter((t) => t.status === 'completed').map((t) => t.id)
    );

    return task.dependsOn.every((depId) => completedIds.has(depId));
  }

  private async executeTaskWithRetry(task: Task, context: TaskExecutionContext): Promise<TaskResult> {
    const logger = getLogger();
    const eventBus = getEventBus();
    const retryStrategy = getRetryStrategy();

    logger.info(`Executing task: ${task.title}`);
    this.options.onTaskStart?.(task);

    await eventBus.emit({
      type: 'task.started',
      projectId: task.projectId,
      taskId: task.id,
      data: { taskTitle: task.title },
      humanReadable: `Started: ${task.title}`,
    });

    const maxRetries = this.options.maxRetries ?? retryStrategy.getMaxRetries();
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const attemptRecord: ExecutionAttempt = {
        attemptNumber: attempt,
        success: false,
        artifacts: [],
        timestamp: new Date(),
      };

      context.attempts.push(attemptRecord);

      try {
        const result = await this.executeTaskAttempt(task, context, attempt);
        attemptRecord.success = result.success;
        attemptRecord.artifacts = result.artifacts || [];

        if (result.success && result.artifacts && result.artifacts.length > 0) {
          this.activeTasks.delete(task.id);
          this.options.onTaskComplete?.(result);
          return result;
        }

        lastError = result.error || 'Task did not produce artifacts';
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        attemptRecord.error = lastError;
      }

      if (attempt <= maxRetries) {
        const pressureLevel = retryStrategy.getPressureLevel(attempt);
        logger.warn(`Task ${task.id} attempt ${attempt} failed, applying ${pressureLevel} pressure`);
        
        const retryContext = {
          originalContext: context.currentPrompt,
          retryCount: attempt,
          maxRetries,
          lastError,
        };

        context.currentPrompt = retryStrategy.buildRetryContext(task, { id: 'orchestrator' }, retryContext);
      }
    }

    const failedResult: TaskResult = {
      taskId: task.id,
      success: false,
      artifacts: context.attempts.flatMap(a => a.artifacts),
      output: '',
      error: lastError || 'Max retries exceeded',
      startedAt: context.attempts[0]?.timestamp || new Date(),
      completedAt: new Date(),
      modelCalls: context.attempts.length,
      costUsd: 0,
    };

    this.activeTasks.delete(task.id);
    this.options.onTaskFail?.(task, new Error(lastError));

    return failedResult;
  }

  private async executeTaskAttempt(task: Task, _context: TaskExecutionContext, attemptNumber: number): Promise<TaskResult> {
    const logger = getLogger();

    await this.sleep(50);

    const hasArtifacts = Math.random() > 0.3;
    const artifacts: string[] = [];
    
    if (hasArtifacts) {
      const numFiles = Math.floor(Math.random() * 3) + 1;
      for (let i = 0; i < numFiles; i++) {
        artifacts.push(`${task.id}/file${i + 1}.ts`);
      }
    }

    const result: TaskResult = {
      taskId: task.id,
      success: hasArtifacts && attemptNumber < 3,
      artifacts,
      output: hasArtifacts ? `Created ${artifacts.length} files` : 'No output',
      startedAt: new Date(),
      completedAt: new Date(),
      modelCalls: 1,
      costUsd: 0.001,
    };

    if (hasArtifacts) {
      logger.success(`Task ${task.id} completed on attempt ${attemptNumber}`);
    } else {
      logger.warn(`Task ${task.id} produced no artifacts on attempt ${attemptNumber}`);
    }

    return result;
  }

  validateResponse(rawResponse: string): { valid: boolean; reason?: string } {
    const result = parseResponse(rawResponse);
    
    if (!result.success) {
      return { valid: false, reason: result.failureReason };
    }

    if (result.files.length === 0) {
      return { valid: false, reason: 'NO_VALID_FILES' };
    }

    return { valid: true };
  }

  getExecutionContext(taskId: string): TaskExecutionContext | undefined {
    return this.activeTasks.get(taskId);
  }

  getAttemptCount(taskId: string): number {
    return this.activeTasks.get(taskId)?.attempts.length ?? 0;
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

let globalOrchestrator: Orchestrator | null = null;

export function initOrchestrator(options?: OrchestratorOptions): Orchestrator {
  globalOrchestrator = new Orchestrator(options);
  return globalOrchestrator;
}

export function getOrchestrator(): Orchestrator {
  if (!globalOrchestrator) {
    return initOrchestrator();
  }
  return globalOrchestrator;
}
