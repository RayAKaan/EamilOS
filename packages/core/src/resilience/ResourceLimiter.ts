import { EventEmitter } from 'events';

export interface ResourceLimit {
  maxConcurrentTasks: number;
  maxMemoryMB: number;
  maxCPUPercent: number;
}

export class ResourceLimiter extends EventEmitter {
  private activeTasks = 0;
  private taskQueue: Array<{
    fn: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];
  private monitoringInterval?: NodeJS.Timeout;

  constructor(private limits: ResourceLimit) {
    super();
    this.limits = {
      maxConcurrentTasks: limits.maxConcurrentTasks ?? 5,
      maxMemoryMB: limits.maxMemoryMB ?? 2048,
      maxCPUPercent: limits.maxCPUPercent ?? 80
    };
    this.startMonitoring();
  }

  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    if (this.canExecute()) {
      return this.execute(fn);
    }

    return new Promise((resolve, reject) => {
      this.taskQueue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject
      });
      this.emit('task:queued', { queueLength: this.taskQueue.length });
    });
  }

  private async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.activeTasks++;
    const taskId = `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    this.emit('task:start', { taskId, activeTasks: this.activeTasks });

    try {
      const result = await fn();
      this.emit('task:complete', { taskId });
      return result;
    } catch (error) {
      this.emit('task:error', { taskId, error: (error as Error).message });
      throw error;
    } finally {
      this.activeTasks--;
      this.processQueue();
    }
  }

  private canExecute(): boolean {
    const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
    return (
      this.activeTasks < this.limits.maxConcurrentTasks &&
      memUsage < this.limits.maxMemoryMB
    );
  }

  private processQueue(): void {
    if (this.taskQueue.length > 0 && this.canExecute()) {
      const nextTask = this.taskQueue.shift();
      if (nextTask) {
        this.execute(nextTask.fn)
          .then(nextTask.resolve)
          .catch(nextTask.reject);
      }
    }
  }

  private startMonitoring(): void {
    if (this.monitoringInterval) return;

    this.monitoringInterval = setInterval(() => {
      const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
      const cpuUsage = process.cpuUsage();

      if (memUsage > this.limits.maxMemoryMB * 0.9) {
        this.emit('resource:warning', {
          type: 'memory',
          usage: memUsage,
          limit: this.limits.maxMemoryMB
        });
      }

      const cpuPercent = cpuUsage.user / 1000000;
      if (cpuPercent > this.limits.maxCPUPercent * 0.9) {
        this.emit('resource:warning', {
          type: 'cpu',
          usage: cpuPercent,
          limit: this.limits.maxCPUPercent
        });
      }
    }, 5000);
  }

  getMetrics() {
    return {
      activeTasks: this.activeTasks,
      queuedTasks: this.taskQueue.length,
      limits: this.limits,
      canExecute: this.canExecute()
    };
  }

  getQueueLength(): number {
    return this.taskQueue.length;
  }

  getActiveTaskCount(): number {
    return this.activeTasks;
  }

  async shutdown(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    for (const task of this.taskQueue) {
      task.reject(new Error('ResourceLimiter shutting down'));
    }
    this.taskQueue = [];
  }
}