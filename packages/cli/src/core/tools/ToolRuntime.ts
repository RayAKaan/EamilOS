export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  readonly name: string;
  readonly description: string;
  readonly execute: (args: TArgs, signal: AbortSignal) => Promise<TResult>;
  readonly timeoutMs?: number;
}

export interface ToolExecution<TArgs = unknown> {
  readonly id: string;
  readonly name: string;
  readonly args: TArgs;
  readonly signal: AbortSignal;
}

export type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'cancel'; reason: string };

export interface ToolResult<TResult = unknown> {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly value?: TResult;
  readonly error?: string;
}

type Hook<T> = (execution: ToolExecution<T>, next: () => Promise<ToolResult>) => Promise<ToolResult>;

export class ToolRuntime {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly preHooks: Array<Hook<unknown>> = [];
  private readonly executeHooks: Array<Hook<unknown>> = [];
  private readonly postHooks: Array<(execution: ToolExecution, result: ToolResult) => Promise<ToolResult>> = [];
  private readonly guards: Array<(execution: ToolExecution) => string | undefined> = [];

  register<TArgs, TResult>(tool: ToolDefinition<TArgs, TResult>): () => void {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool as ToolDefinition);
    return () => this.tools.delete(tool.name);
  }

  restrict(names: Iterable<string>): () => void {
    const allowed = new Set(names);
    const previous = this.guards.length;
    this.guards.push((execution) => allowed.has(execution.name) ? undefined : 'Tool is not available in this agent scope.');
    return () => this.guards.splice(previous, 1);
  }

  guard(check: (execution: ToolExecution) => string | undefined): () => void {
    this.guards.push(check);
    return () => {
      const index = this.guards.indexOf(check);
      if (index >= 0) this.guards.splice(index, 1);
    };
  }

  onPreExecute(hook: Hook<unknown>): () => void {
    this.preHooks.push(hook);
    return () => this.remove(this.preHooks, hook);
  }

  onExecute(hook: Hook<unknown>): () => void {
    this.executeHooks.push(hook);
    return () => this.remove(this.executeHooks, hook);
  }

  onPostExecute(hook: (execution: ToolExecution, result: ToolResult) => Promise<ToolResult>): () => void {
    this.postHooks.push(hook);
    return () => this.remove(this.postHooks, hook);
  }

  schemas(): Array<Pick<ToolDefinition, 'name' | 'description' | 'timeoutMs'>> {
    return [...this.tools.values()].map(({ name, description, timeoutMs }) => ({ name, description, timeoutMs }));
  }

  async execute<TArgs, TResult>(name: string, args: TArgs, signal: AbortSignal): Promise<ToolResult<TResult>> {
    const tool = this.tools.get(name) as ToolDefinition<TArgs, TResult> | undefined;
    const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (!tool) return { id, name, ok: false, error: `Unknown tool: ${name}` };

    const execution: ToolExecution<TArgs> = { id, name, args, signal };
    for (const guard of this.guards) {
      const reason = guard(execution);
      if (reason) return { id, name, ok: false, error: reason };
    }
    if (signal.aborted) return { id, name, ok: false, error: 'Tool execution cancelled' };

    const pre = await this.runHooks(this.preHooks, execution, async () => ({ id, name, ok: true }));
    if (!pre.ok) return pre as ToolResult<TResult>;

    const result = await this.runHooks(this.executeHooks, execution, async () => {
      try {
        const value = await this.withTimeout(tool.execute(args, signal), tool.timeoutMs ?? 120000, signal);
        return { id, name, ok: true, value };
      } catch (error) {
        return { id, name, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

    let finalResult = result;
    for (const hook of this.postHooks) {
      finalResult = await hook(execution, finalResult);
    }
    if (signal.aborted && finalResult.ok) return { id, name, ok: false, error: 'Tool execution cancelled' };
    return finalResult as ToolResult<TResult>;
  }

  private async runHooks(
    hooks: Array<Hook<unknown>>,
    execution: ToolExecution,
    terminal: () => Promise<ToolResult>,
    index = 0,
  ): Promise<ToolResult> {
    const hook = hooks[index];
    if (!hook) return terminal();
    return hook(execution, () => this.runHooks(hooks, execution, terminal, index + 1));
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new Error('Tool execution cancelled');
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        fn();
      };
      const onAbort = () => finish(() => reject(new Error('Tool execution cancelled')));
      const timer = setTimeout(() => finish(() => reject(new Error(`Tool timed out after ${timeoutMs}ms`))), timeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    });
  }

  private remove<T>(list: T[], value: T): void {
    const index = list.indexOf(value);
    if (index >= 0) list.splice(index, 1);
  }
}
