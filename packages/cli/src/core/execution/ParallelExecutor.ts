import { DependencyGraph } from "./DependencyGraph.js";
import { ExplainableError } from "../errors/ExplainableError.js";

export interface TaskConfig {
  id: string;
  title?: string;
  description?: string;
  dependsOn?: string[];
  assignedModel?: string;
  agentId?: string;
}

export interface ExecutionResult {
  taskId: string;
  status: "success" | "failed";
  output?: unknown;
  error?: string;
  durationMs?: number;
}

export interface AgentRunner {
  run(
    task: TaskConfig,
    context: Map<string, ExecutionResult>
  ): Promise<ExecutionResult>;
}

export type EventCallback = (event: ExecutionEvent) => void;

export interface ExecutionEvent {
  type:
    | "task:start"
    | "task:complete"
    | "task:failed"
    | "execution:start"
    | "execution:complete"
    | "execution:error";
  taskId?: string;
  data?: unknown;
}

export class ParallelExecutor {
  private concurrencyLimit: number;
  private eventCallbacks: EventCallback[] = [];

  constructor(options: { maxParallel?: number } = {}) {
    this.concurrencyLimit = options.maxParallel ?? 3;
  }

  onEvent(callback: EventCallback): void {
    this.eventCallbacks.push(callback);
  }

  private emit(event: ExecutionEvent): void {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch {
        // Ignore callback errors
      }
    }
  }

  async executeTasks(
    tasks: TaskConfig[],
    agentRunner: AgentRunner
  ): Promise<ExecutionResult[]> {
    const graph = DependencyGraph.fromTasks(
      tasks.map((t) => ({
        taskId: t.id,
        dependsOn: t.dependsOn || [],
      }))
    );

    graph.validateNoCycles();

    const results: Map<string, ExecutionResult> = new Map();
    const completed: Set<string> = new Set();
    const running: Set<string> = new Set();
    const context: Map<string, ExecutionResult> = new Map();

    this.emit({
      type: "execution:start",
      data: { taskCount: tasks.length, maxParallel: this.concurrencyLimit },
    });

    while (completed.size < tasks.length) {
      const readyTasks = graph.getReadyTasks(completed);

      if (readyTasks.length === 0 && running.size === 0) {
        const remaining = tasks.filter((t) => !completed.has(t.id));
        throw new ExplainableError({
          code: "EXECUTION_DEADLOCK",
          title: "Task Execution Deadlocked",
          message: `${remaining.length} tasks stuck — likely circular dependency.`,
          fixes: [
            `Check dependencies for: ${remaining.map((t) => t.id).join(", ")}`,
            `Run 'eamilos validate' to check your configuration`,
          ],
        });
      }

      const slotsAvailable = this.concurrencyLimit - running.size;
      const tasksToDispatch = readyTasks.slice(0, slotsAvailable);

      if (tasksToDispatch.length === 0) {
        await sleep(50);
        continue;
      }

      for (const taskId of tasksToDispatch) {
        running.add(taskId);
        const task = tasks.find((t) => t.id === taskId)!;

        this.emit({ type: "task:start", taskId });

        this.runTask(task, agentRunner, context, results, completed, running).catch(
          (error) => {
            console.error(`Task ${taskId} failed:`, error);
          }
        );
      }

      if (running.size > 0) {
        await Promise.race(
          [...running].map((id) =>
            new Promise<void>((resolve) => {
              const checkInterval = setInterval(() => {
                if (!running.has(id)) {
                  clearInterval(checkInterval);
                  resolve();
                }
              }, 50);
            })
          )
        );
      }
    }

    this.emit({
      type: "execution:complete",
      data: {
        totalTasks: tasks.length,
        succeeded: [...results.values()].filter((r) => r.status === "success").length,
        failed: [...results.values()].filter((r) => r.status === "failed").length,
      },
    });

    return Array.from(results.values());
  }

  private async runTask(
    task: TaskConfig,
    agentRunner: AgentRunner,
    context: Map<string, ExecutionResult>,
    results: Map<string, ExecutionResult>,
    completed: Set<string>,
    running: Set<string>
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const result = await agentRunner.run(task, context);

      results.set(task.id, {
        taskId: task.id,
        status: result.status,
        output: result.output,
        error: result.error,
        durationMs: Date.now() - startTime,
      });

      context.set(task.id, result);
      completed.add(task.id);
      running.delete(task.id);

      if (result.status === "success") {
        this.emit({ type: "task:complete", taskId: task.id, data: result });
      } else {
        this.emit({ type: "task:failed", taskId: task.id, data: result });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      results.set(task.id, {
        taskId: task.id,
        status: "failed",
        error: errorMessage,
        durationMs: Date.now() - startTime,
      });

      completed.add(task.id);
      running.delete(task.id);

      this.emit({
        type: "task:failed",
        taskId: task.id,
        data: { error: errorMessage },
      });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
