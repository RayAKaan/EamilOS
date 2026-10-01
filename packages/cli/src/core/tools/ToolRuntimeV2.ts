import { randomUUID } from 'node:crypto';

export type ToolPresentation =
  | { kind: 'generic'; title?: string; body?: string }
  | { kind: 'terminal'; command: string; output?: string; exitCode?: number | null }
  | { kind: 'diff'; patch: string }
  | { kind: 'search'; query: string; results: Array<{ title: string; uri?: string; snippet?: string }> }
  | { kind: 'web'; uri: string; title?: string; text?: string };

export interface ToolSchema {
  readonly type: 'object';
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
}

export interface ToolRuntimeDefinition<TArgs = unknown, TResult = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolSchema;
  readonly execute: (args: TArgs, ctx: ToolExecutionContext) => Promise<TResult>;
  readonly timeoutMs?: number;
  readonly concurrency?: 'parallel' | 'exclusive';
  readonly presentation?: (result: TResult) => ToolPresentation;
  readonly modelOutput?: (result: TResult) => unknown;
}

export interface ToolExecutionContext {
  readonly id: string;
  readonly tool: string;
  readonly signal: AbortSignal;
  readonly agentId?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ToolRuntimeResult<TResult = unknown> {
  readonly id: string;
  readonly tool: string;
  readonly ok: boolean;
  readonly value?: TResult;
  readonly error?: string;
  readonly presentation?: ToolPresentation;
  readonly modelOutput?: unknown;
}

export type ToolGuard = (ctx: ToolExecutionContext, args: unknown) => string | undefined;

export class ToolRuntimeV2 {
  private readonly tools = new Map<string, ToolRuntimeDefinition>();
  private readonly guards: ToolGuard[] = [];
  private readonly exclusive = new Map<string, Promise<void>>();

  register<TArgs, TResult>(tool: ToolRuntimeDefinition<TArgs, TResult>): () => void {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool as ToolRuntimeDefinition);
    return () => this.tools.delete(tool.name);
  }

  guard(guard: ToolGuard): () => void {
    this.guards.push(guard);
    return () => {
      const index = this.guards.indexOf(guard);
      if (index >= 0) this.guards.splice(index, 1);
    };
  }

  restrict(names: Iterable<string>): () => void {
    const allowed = new Set(names);
    return this.guard((ctx) => allowed.has(ctx.tool) ? undefined : 'Tool is not available in this scope.');
  }

  schemas(): Array<{ name: string; description: string; inputSchema: ToolSchema; concurrency: string }> {
    return [...this.tools.values()].map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      concurrency: tool.concurrency ?? 'parallel',
    }));
  }

  get(name: string): ToolRuntimeDefinition | undefined {
    return this.tools.get(name);
  }

  async execute<TArgs, TResult>(
    name: string,
    args: TArgs,
    signal: AbortSignal,
    options: { agentId?: string; metadata?: Record<string, unknown> } = {},
  ): Promise<ToolRuntimeResult<TResult>> {
    const tool = this.tools.get(name) as ToolRuntimeDefinition<TArgs, TResult> | undefined;
    const id = randomUUID();
    if (!tool) return { id, tool: name, ok: false, error: `Unknown tool: ${name}` };

    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal.reason);
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', forwardAbort, { once: true });

    const ctx: ToolExecutionContext = {
      id,
      tool: name,
      signal: controller.signal,
      agentId: options.agentId,
      metadata: options.metadata ?? {},
    };

    try {
      for (const guard of this.guards) {
        const reason = guard(ctx, args);
        if (reason) return { id, tool: name, ok: false, error: reason };
      }

      const execute = async (): Promise<ToolRuntimeResult<TResult>> => {
        try {
          const value = await this.withTimeout(
            tool.execute(args, ctx),
            tool.timeoutMs ?? 120_000,
            controller.signal,
          );
          return {
            id,
            tool: name,
            ok: true,
            value,
            presentation: tool.presentation?.(value),
            modelOutput: tool.modelOutput?.(value) ?? value,
          };
        } catch (error) {
          return {
            id,
            tool: name,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      };

      if (tool.concurrency !== 'exclusive') return await execute();

      const previous = this.exclusive.get(name) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>(resolve => { release = resolve; });
      this.exclusive.set(name, current);
      await previous;
      try {
        return await execute();
      } finally {
        release();
        if (this.exclusive.get(name) === current) this.exclusive.delete(name);
      }
    } finally {
      signal.removeEventListener('abort', forwardAbort);
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new Error('Tool execution cancelled');
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(() => reject(new Error(`Tool timed out after ${timeoutMs}ms`))), timeoutMs);
      const onAbort = () => finish(() => reject(new Error('Tool execution cancelled')));
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        fn();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(v => finish(() => resolve(v)), e => finish(() => reject(e)));
    });
  }
}
