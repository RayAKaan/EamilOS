import { ToolCall, ToolResult, ToolDefinition } from './types.js';
import { getToolRegistry } from './registry.js';

export interface ExecutorOptions {
  timeout?: number;
  onToolStart?: (tool: ToolDefinition, args: unknown) => void | Promise<void>;
  onToolComplete?: (result: ToolResult) => void | Promise<void>;
  onToolError?: (tool: ToolDefinition, error: Error) => void | Promise<void>;
}

export class ToolExecutor {
  private options: ExecutorOptions;

  constructor(options: ExecutorOptions = {}) {
    this.options = options;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const registry = getToolRegistry();
    const tool = registry.get(call.name);

    if (!tool) {
      return {
        callId: call.id,
        success: false,
        error: `Unknown tool: ${call.name}`,
        durationMs: 0,
      };
    }

    const startTime = Date.now();

    try {
      await this.options.onToolStart?.(tool, call.args);

      const result = await this.executeWithTimeout(tool, call.args);

      const durationMs = Date.now() - startTime;
      const toolResult: ToolResult = {
        callId: call.id,
        success: true,
        result,
        durationMs,
      };

      await this.options.onToolComplete?.(toolResult);
      return toolResult;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.options.onToolError?.(tool, error instanceof Error ? error : new Error(errorMessage));

      return {
        callId: call.id,
        success: false,
        error: errorMessage,
        durationMs,
      };
    }
  }

  async executeAll(calls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(calls.map((call) => this.execute(call)));
  }

  async executeWithTimeout(tool: ToolDefinition, args: unknown): Promise<unknown> {
    const timeout = this.options.timeout ?? 60000;

    return Promise.race([
      tool.execute(args),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Tool ${tool.name} timed out after ${timeout}ms`)), timeout)
      ),
    ]);
  }

  validateToolCall(call: ToolCall): { valid: boolean; error?: string } {
    const tool = getToolRegistry().get(call.name);

    if (!tool) {
      return { valid: false, error: `Unknown tool: ${call.name}` };
    }

    const result = tool.inputSchema.safeParse(call.args);
    if (!result.success) {
      return {
        valid: false,
        error: `Invalid arguments for ${call.name}: ${result.error.message}`,
      };
    }

    return { valid: true };
  }
}

export function createExecutor(options?: ExecutorOptions): ToolExecutor {
  return new ToolExecutor(options);
}
