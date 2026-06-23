import {
  Task,
  TaskCreate,
  TaskStatus,
  ProjectStatusInfo,
  validateTaskTransition,
} from './types.js';
import { getDatabase, DatabaseManager } from './db.js';

export class TaskManager {
  private db: DatabaseManager;

  constructor(db?: DatabaseManager) {
    this.db = db ?? getDatabase();
  }

  createTask(data: TaskCreate): Task {
    return this.db.createTask(data);
  }

  createTasks(dataList: TaskCreate[]): Task[] {
    const tasks: Task[] = [];
    for (const data of dataList) {
      tasks.push(this.db.createTask(data));
    }
    return tasks;
  }

  getTask(id: string): Task | null {
    return this.db.getTask(id);
  }

  getProjectTasks(projectId: string): Task[] {
    return this.db.getProjectTasks(projectId);
  }

  getReadyTasks(projectId: string): Task[] {
    return this.db.getReadyTasks(projectId);
  }

  getInProgressCount(projectId: string): number {
    return this.db.getInProgressTasks(projectId).length;
  }

  getProjectStatus(projectId: string): ProjectStatusInfo {
    const tasks = this.getProjectTasks(projectId);

    const status: ProjectStatusInfo = {
      total: tasks.length,
      completed: 0,
      failed: 0,
      inProgress: 0,
      pending: 0,
      allCompleted: false,
      hasFailures: false,
      hasInProgress: false,
    };

    for (const task of tasks) {
      switch (task.status) {
        case 'completed':
          status.completed++;
          break;
        case 'failed':
          status.failed++;
          break;
        case 'in_progress':
          status.inProgress++;
          break;
        case 'pending':
        case 'ready':
        case 'blocked':
        case 'waiting_approval':
          status.pending++;
          break;
      }
    }

    status.allCompleted =
      status.total > 0 && status.completed + status.failed === status.total;
    status.hasFailures = status.failed > 0;
    status.hasInProgress = status.inProgress > 0;

    return status;
  }

  startTask(taskId: string, agentId: string): void {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    this.updateTaskStatus(taskId, 'in_progress');
    this.db.updateTask(taskId, {
      assignedAgent: agentId,
    });
  }

  completeTask(taskId: string, output: string, artifacts: string[]): void {
    this.db.updateTask(taskId, {
      status: 'completed',
      output,
      artifacts,
      lockedBy: null,
    });
  }

  failTask(taskId: string, error: string): void {
    this.db.updateTask(taskId, {
      status: 'failed',
      error,
      lockedBy: null,
    });
  }

  setTaskError(taskId: string, error: string): void {
    this.db.updateTask(taskId, { error });
  }

  retryTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== 'failed' && task.status !== 'interrupted') {
      throw new Error(`Cannot retry task in status: ${task.status}`);
    }

    this.db.updateTask(taskId, {
      status: 'ready',
      error: undefined,
      lockedBy: null,
      retryCount: task.retryCount + 1,
    });
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    validateTaskTransition(task.status, status);
    this.db.updateTaskStatus(taskId, status);
  }

  updateTask(
    taskId: string,
    updates: Partial<{
      status: TaskStatus;
      output: string;
      artifacts: string[];
      retryCount: number;
      error: string;
      tokenUsage: number;
      costUsd: number;
    }>
  ): void {
    this.db.updateTask(taskId, updates);
  }

  lockTask(taskId: string, instanceId: string): boolean {
    return this.db.lockTask(taskId, instanceId);
  }

  unlockTask(taskId: string): void {
    this.db.updateTask(taskId, { lockedBy: null });
  }

  cancelTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status === 'completed' || task.status === 'cancelled') {
      throw new Error(`Cannot cancel task in terminal state: ${task.status}`);
    }

    this.updateTaskStatus(taskId, 'cancelled');
    this.unlockTask(taskId);
  }

  cancelProjectTasks(projectId: string): void {
    const tasks = this.getProjectTasks(projectId);
    for (const task of tasks) {
      if (task.status !== 'completed' && task.status !== 'cancelled') {
        try {
          this.cancelTask(task.id);
        } catch (error) {
          console.warn(`Failed to cancel task ${task.id}:`, error);
        }
      }
    }
  }

  resetFailedTasks(projectId: string): number {
    const tasks = this.getProjectTasks(projectId);
    let count = 0;
    for (const task of tasks) {
      if (task.status === 'failed') {
        try {
          this.retryTask(task.id);
          count++;
        } catch (error) {
          console.warn(`Failed to retry task ${task.id}:`, error);
        }
      }
    }
    return count;
  }

  detectCircularDependencies(
    _projectId: string,
    taskId: string,
    dependsOn: string[]
  ): boolean {
    const visited = new Set<string>();
    const stack = [...dependsOn];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === taskId) {
        return true;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const task = this.getTask(current);
      if (task && task.dependsOn.length > 0) {
        stack.push(...task.dependsOn);
      }
    }

    return false;
  }

  updateBlockedTasks(projectId: string): void {
    const tasks = this.getProjectTasks(projectId);

    for (const task of tasks) {
      if (task.status === 'blocked') {
        const allDepsCompleted = task.dependsOn.every((depId) => {
          const dep = this.getTask(depId);
          return dep?.status === 'completed';
        });

        if (allDepsCompleted) {
          try {
            this.updateTaskStatus(task.id, 'ready');
          } catch (error) {
            console.warn(`Failed to unblock task ${task.id}:`, error);
          }
        }
      }
    }
  }
}

let globalTaskManager: TaskManager | null = null;

export function initTaskManager(db?: DatabaseManager): TaskManager {
  globalTaskManager = new TaskManager(db);
  return globalTaskManager;
}

export function getTaskManager(): TaskManager {
  if (!globalTaskManager) {
    return initTaskManager();
  }
  return globalTaskManager;
}
