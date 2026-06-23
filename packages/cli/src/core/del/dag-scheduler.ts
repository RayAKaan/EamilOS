import {
  TaskDAG,
  AgentTask,
  OrchestrationEvent,
  isCriticalRole,
} from './multi-agent-types.js';
import { ClassifiedError } from './stateful-types.js';

export interface SchedulerConfig {
  maxParallelAgents: number;
  taskTimeoutMs: number;
  abortOnCriticalFailure: boolean;
}

const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  maxParallelAgents: 4,
  taskTimeoutMs: 120000,
  abortOnCriticalFailure: true,
};

export type TaskExecutor = (
  task: AgentTask,
  contextSnapshot: unknown
) => Promise<{ success: boolean; result?: unknown; error?: ClassifiedError }>;

export interface ScheduleResult {
  dag: TaskDAG;
  completedTasks: string[];
  failedTasks: string[];
  cancelledTasks: string[];
}

export class DAGScheduler {
  private config: SchedulerConfig;
  private listeners: Array<(event: OrchestrationEvent) => void> = [];

  constructor(config?: Partial<SchedulerConfig>) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
  }

  async execute(
    dag: TaskDAG,
    executor: TaskExecutor,
    getSnapshot: () => unknown
  ): Promise<ScheduleResult> {
    dag.status = 'running';

    const completedTasks: string[] = [];
    const failedTasks: string[] = [];
    const cancelledTasks: string[] = [];
    const taskMap = new Map<string, AgentTask>();
    const goalToTaskId = new Map<string, string>();

    for (const task of Object.values(dag.tasks)) {
      taskMap.set(task.id, task);
      goalToTaskId.set(task.goal, task.id);
    }

    const updateTaskStatus = (taskId: string, status: AgentTask['status'], error?: ClassifiedError) => {
      const task = taskMap.get(taskId);
      if (task) {
        task.status = status;
        task.error = error;
        if (status === 'running') task.startedAt = Date.now();
        if (status === 'done' || status === 'failed') task.completedAt = Date.now();
      }
    };

    const cancelDependentTasks = (failedTaskId: string) => {
      for (const task of taskMap.values()) {
        const depTaskIds = task.dependsOn
          .map(goal => goalToTaskId.get(goal))
          .filter((id): id is string => id !== undefined);
        if (depTaskIds.includes(failedTaskId) && task.status === 'pending') {
          task.status = 'cancelled';
          cancelledTasks.push(task.id);
          this.emit({ type: 'TASK_CANCELLED', taskId: task.id, reason: `Dependency ${failedTaskId} failed` });
        }
      }
    };

    const isBlocked = (task: AgentTask): boolean => {
      if (task.status !== 'pending') return false;
      for (const depGoal of task.dependsOn) {
        const depTaskId = goalToTaskId.get(depGoal);
        if (!depTaskId) return true;
        const depTask = taskMap.get(depTaskId);
        if (!depTask || depTask.status !== 'done') {
          return true;
        }
      }
      return false;
    };

    const getReadyTasks = (): AgentTask[] => {
      return Array.from(taskMap.values()).filter(t => t.status === 'pending' && !isBlocked(t));
    };

    const checkCriticalFailure = (taskId: string): boolean => {
      const task = taskMap.get(taskId);
      if (!task) return false;
      return this.config.abortOnCriticalFailure && isCriticalRole(task.role);
    };

    let shouldAbort = false;

    while (!shouldAbort) {
      const readyTasks = getReadyTasks();

      if (readyTasks.length === 0) {
        const hasRunning = Array.from(taskMap.values()).some(t => t.status === 'running');
        const hasPending = Array.from(taskMap.values()).some(t => t.status === 'pending');
        if (!hasRunning && !hasPending) break;
        await this.sleep(100);
        continue;
      }

      const batch = readyTasks.slice(0, this.config.maxParallelAgents);

      const promises = batch.map(async (task) => {
        updateTaskStatus(task.id, 'running');
        this.emit({ type: 'TASK_STARTED', taskId: task.id, provider: task.assignedProvider || 'default' });

        try {
          const snapshot = getSnapshot();
          const result = await this.withTimeout(
            executor(task, snapshot),
            this.config.taskTimeoutMs
          );

          if (result.success) {
            updateTaskStatus(task.id, 'done');
            task.result = result.result;
            completedTasks.push(task.id);
            this.emit({
              type: 'TASK_COMPLETED',
              taskId: task.id,
              contextVersion: 0,
            });
          } else {
            updateTaskStatus(task.id, 'failed', result.error);
            failedTasks.push(task.id);
            this.emit({
              type: 'TASK_FAILED',
              taskId: task.id,
              error: result.error!,
              recoverable: result.error?.retryable ?? false,
            });

            if (checkCriticalFailure(task.id)) {
              shouldAbort = true;
            }

            cancelDependentTasks(task.id);
          }
        } catch (error) {
          const classifiedError: ClassifiedError = {
            code: 'SYNTAX_ERROR' as never,
            message: error instanceof Error ? error.message : 'Unknown error',
            context: task.id,
            stage: 'content' as never,
            failureType: 'content_error' as never,
            retryable: false,
            suggestedStrategy: 'retry_strict',
          };

          updateTaskStatus(task.id, 'failed', classifiedError);
          failedTasks.push(task.id);
          this.emit({
            type: 'TASK_FAILED',
            taskId: task.id,
            error: classifiedError,
            recoverable: false,
          });

          if (checkCriticalFailure(task.id)) {
            shouldAbort = true;
          }

          cancelDependentTasks(task.id);
        }
      });

      await Promise.allSettled(promises);

      if (shouldAbort) {
        for (const task of taskMap.values()) {
          if (task.status === 'pending' || task.status === 'blocked') {
            task.status = 'cancelled';
            cancelledTasks.push(task.id);
            this.emit({ type: 'TASK_CANCELLED', taskId: task.id, reason: 'Critical task failure - aborting DAG' });
          }
        }
      }
    }

    dag.status = shouldAbort || failedTasks.length > 0 ? 'failed' : 'completed';
    if (dag.status === 'completed') {
      dag.completedAt = Date.now();
    }

    return {
      dag,
      completedTasks,
      failedTasks,
      cancelledTasks,
    };
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    const timeout = new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Task timed out after ${ms}ms`)), ms)
    );
    return Promise.race([promise, timeout]);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  subscribe(listener: (event: OrchestrationEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }

  private emit(event: OrchestrationEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Scheduler listener error:', error);
      }
    }
  }

  getConfig(): SchedulerConfig {
    return { ...this.config };
  }
}

let globalScheduler: DAGScheduler | null = null;

export function initDAGScheduler(config?: Partial<SchedulerConfig>): DAGScheduler {
  if (globalScheduler) return globalScheduler;
  globalScheduler = new DAGScheduler(config);
  return globalScheduler;
}

export function getDAGScheduler(): DAGScheduler {
  return globalScheduler || initDAGScheduler();
}
