import fs from 'fs';
import path from 'path';
import type { PersistedTask, TaskStoreConfig, RemoteTaskResult, TaskPriority } from './types.js';

export class TaskStore {
  private filePath: string;
  private tasks: Record<string, PersistedTask> = {};
  private autoSaveInterval?: ReturnType<typeof setInterval>;
  private autoSaveIntervalMs: number;

  constructor(config: TaskStoreConfig = {}) {
    const persistDir = config.persistPath || '.eamilos';
    const resolvedPath = path.resolve(process.cwd(), persistDir);

    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
    }

    this.filePath = path.join(resolvedPath, 'tasks.json');
    this.autoSaveIntervalMs = config.autoSaveIntervalMs || 30000;
    this.loadAll();
  }

  save(task: PersistedTask): void {
    this.tasks[task.taskId] = {
      ...task,
      timestamp: task.timestamp || Date.now(),
      attempts: task.attempts || 1,
    };
    this.persist();
  }

  update(taskId: string, updates: Partial<PersistedTask>): void {
    if (!this.tasks[taskId]) return;

    this.tasks[taskId] = {
      ...this.tasks[taskId],
      ...updates,
    };
    this.persist();
  }

  get(taskId: string): PersistedTask | undefined {
    return this.tasks[taskId];
  }

  delete(taskId: string): void {
    delete this.tasks[taskId];
    this.persist();
  }

  loadAll(): Record<string, PersistedTask> {
    if (!fs.existsSync(this.filePath)) {
      this.tasks = {};
      return this.tasks;
    }

    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      this.tasks = JSON.parse(content) as Record<string, PersistedTask>;
    } catch {
      this.tasks = {};
      const backupPath = this.filePath + '.corrupted.' + Date.now();
      try {
        fs.renameSync(this.filePath, backupPath);
        console.warn(`TaskStore: corrupted file backed up to ${backupPath}`);
      } catch {
        // ignore backup error
      }
    }

    return this.tasks;
  }

  getPending(): PersistedTask[] {
    return Object.values(this.tasks).filter(
      (t) => t.status === 'pending' || t.status === 'running'
    );
  }

  getFailed(): PersistedTask[] {
    return Object.values(this.tasks).filter((t) => t.status === 'failed');
  }

  getByNode(nodeId: string): PersistedTask[] {
    return Object.values(this.tasks).filter((t) => t.assignedNode === nodeId);
  }

  getByPriority(priority: TaskPriority): PersistedTask[] {
    return Object.values(this.tasks).filter((t) => t.priority === priority);
  }

  getSortedByPriority(): PersistedTask[] {
    const priorityScore = (p?: TaskPriority): number => {
      return p === 'high' ? 3 : p === 'normal' ? 2 : 1;
    };

    return Object.values(this.tasks).sort(
      (a, b) => priorityScore(b.priority) - priorityScore(a.priority)
    );
  }

  markRunning(taskId: string, nodeId: string): void {
    this.update(taskId, { status: 'running', assignedNode: nodeId });
  }

  markCompleted(taskId: string, result: RemoteTaskResult): void {
    this.update(taskId, { status: 'completed', result });
  }

  markFailed(taskId: string, error?: string): void {
    const task = this.tasks[taskId];
    if (task) {
      this.update(taskId, {
        status: 'failed',
        result: task.result
          ? { ...task.result, success: false, error }
          : undefined,
      });
    }
  }

  incrementAttempts(taskId: string): number {
    const task = this.tasks[taskId];
    if (!task) return 0;
    const newAttempts = task.attempts + 1;
    this.update(taskId, { attempts: newAttempts });
    return newAttempts;
  }

  clearCompleted(olderThanMs?: number): number {
    const now = Date.now();
    let cleared = 0;

    for (const taskId of Object.keys(this.tasks)) {
      const task = this.tasks[taskId];
      if (task.status === 'completed') {
        if (!olderThanMs || now - task.timestamp > olderThanMs) {
          delete this.tasks[taskId];
          cleared++;
        }
      }
    }

    if (cleared > 0) {
      this.persist();
    }

    return cleared;
  }

  startAutoSave(): void {
    if (this.autoSaveInterval) return;

    this.autoSaveInterval = setInterval(() => {
      this.persist();
    }, this.autoSaveIntervalMs);
  }

  stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = undefined;
    }
  }

  private persist(): void {
    const tempPath = this.filePath + '.tmp';
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(tempPath, JSON.stringify(this.tasks, null, 2));
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      console.error('Failed to persist tasks:', error);
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // ignore cleanup error
        }
      }
    }
  }

  getStats(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    byPriority: Record<TaskPriority, number>;
  } {
    const tasks = Object.values(this.tasks);
    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      running: tasks.filter((t) => t.status === 'running').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      byPriority: {
        high: tasks.filter((t) => t.priority === 'high').length,
        normal: tasks.filter((t) => t.priority === 'normal').length,
        low: tasks.filter((t) => t.priority === 'low').length,
      },
    };
  }
}

let globalTaskStore: TaskStore | null = null;

export function initTaskStore(config?: TaskStoreConfig): TaskStore {
  globalTaskStore = new TaskStore(config);
  return globalTaskStore;
}

export function getTaskStore(): TaskStore | null {
  return globalTaskStore;
}
