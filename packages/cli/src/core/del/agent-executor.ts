import { AgentTask, ContextSnapshot } from './multi-agent-types.js';
import { ClassifiedError } from './stateful-types.js';
import { DELExecutor } from './executor.js';
import { DELConfig, DEFAULT_DEL_CONFIG, RawProviderOutput, GuaranteedFile } from './types.js';
import { DELValidationError, DELErrorCode } from './types.js';

export interface ExecutorConfig {
  delConfig: Partial<DELConfig>;
  enablePhase1Validation: boolean;
  timeoutMs: number;
}

const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  delConfig: {},
  enablePhase1Validation: true,
  timeoutMs: 120000,
};

export interface AgentExecutionInput {
  task: AgentTask;
  snapshot: ContextSnapshot;
  workspaceRoot: string;
}

export interface AgentExecutionResult {
  success: boolean;
  result?: unknown;
  error?: ClassifiedError;
  validatedFiles?: Array<{ path: string; content: string }>;
}

export class AgentExecutor {
  private config: ExecutorConfig;
  private delExecutor: DELExecutor;

  constructor(config?: Partial<ExecutorConfig>) {
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
    const fullConfig: DELConfig = { ...DEFAULT_DEL_CONFIG, ...this.config.delConfig };
    this.delExecutor = new DELExecutor(fullConfig);
  }

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const { task, snapshot } = input;

    try {
      const prompt = this.buildPrompt(task, snapshot);

      const provider = task.assignedProvider || 'claude';

      const rawOutput = await this.callProvider(provider, prompt);

      if (!this.config.enablePhase1Validation) {
        return {
          success: true,
          result: { raw: rawOutput, prompt },
        };
      }

      const rawProviderOutput: RawProviderOutput = {
        providerId: provider as RawProviderOutput['providerId'],
        rawText: rawOutput,
        metadata: {
          model: provider,
          latencyMs: 0,
          tokenCount: rawOutput.length / 4,
        },
      };

      const validatedResult = await this.delExecutor.execute(rawProviderOutput);

      if (validatedResult.success && validatedResult.receipt) {
        return {
          success: true,
          result: {
            files: validatedResult.receipt.filesWritten,
            extractionStrategy: validatedResult.receipt.extractionStrategy,
            attemptCount: validatedResult.receipt.attemptCount,
          },
          validatedFiles: validatedResult.receipt.filesWritten.map((f: GuaranteedFile) => ({
            path: f.path,
            content: f.content,
          })),
        };
      }

      const lastError = validatedResult.errors[validatedResult.errors.length - 1];
      const classifiedError = this.classifyValidationError(lastError);

      return {
        success: false,
        error: classifiedError,
      };
    } catch (error) {
      const classifiedError: ClassifiedError = {
        code: 'SYNTAX_ERROR' as DELErrorCode,
        message: error instanceof Error ? error.message : 'Unknown execution error',
        context: task.id,
        stage: 'content',
        failureType: 'content_error',
        retryable: true,
        suggestedStrategy: 'retry_strict',
      };

      return {
        success: false,
        error: classifiedError,
      };
    }
  }

  private buildPrompt(task: AgentTask, snapshot: ContextSnapshot): string {
    const contextParts: string[] = [];

    if (Object.keys(snapshot.state).length > 0) {
      contextParts.push('## Context from Previous Tasks\n');
      for (const [key, value] of Object.entries(snapshot.state)) {
        contextParts.push(`### ${key}\n${JSON.stringify(value, null, 2)}\n`);
      }
    }

    return `${contextParts.join('\n')}

## Current Task
Role: ${task.role}
Goal: ${task.goal}
Task ID: ${task.id}

Please execute this task and output the result in a format suitable for file writing.`;
  }

  private async callProvider(provider: string, prompt: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      switch (provider.toLowerCase()) {
        case 'claude':
        case 'anthropic':
          return await this.callClaude(prompt, controller.signal);
        case 'openai':
        case 'gpt':
          return await this.callOpenAI(prompt, controller.signal);
        default:
          return await this.callOllama(prompt, controller.signal);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async callClaude(prompt: string, _signal: AbortSignal): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not set');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`);
    }

    const data = await response.json() as { content: Array<{ text: string }> };
    return data.content[0]?.text || '';
  }

  private async callOpenAI(prompt: string, _signal: AbortSignal): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not set');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 8192,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message.content || '';
  }

  private async callOllama(prompt: string, _signal: AbortSignal): Promise<string> {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json() as { response: string };
    return data.response;
  }

  private classifyValidationError(error?: DELValidationError): ClassifiedError {
    if (!error) {
      return {
        code: 'SYNTAX_ERROR' as DELErrorCode,
        message: 'Unknown validation error',
        context: 'unknown',
        stage: 'content',
        failureType: 'content_error',
        retryable: true,
        suggestedStrategy: 'retry_standard',
      };
    }

    const code = error.code;
    let failureType: ClassifiedError['failureType'] = 'format_error';
    let retryable = true;

    switch (code) {
      case 'EXTRACTION_FAILURE':
        failureType = 'format_error';
        break;
      case 'SCHEMA_MISMATCH':
        failureType = 'schema_error';
        break;
      case 'PLACEHOLDER_DETECTED':
      case 'LOW_CODE_DENSITY':
        failureType = 'content_error';
        break;
      case 'PATH_TRAVERSAL':
      case 'SECRET_DETECTED':
        failureType = 'security_error';
        retryable = false;
        break;
      case 'SYNTAX_ERROR':
        failureType = 'content_error';
        break;
    }

    let suggestedStrategy: string;
    switch (code) {
      case 'EXTRACTION_FAILURE':
      case 'SCHEMA_MISMATCH':
        suggestedStrategy = 'retry_strict';
        break;
      case 'PLACEHOLDER_DETECTED':
      case 'LOW_CODE_DENSITY':
        suggestedStrategy = 'retry_decompose';
        break;
      default:
        suggestedStrategy = 'retry_standard';
    }

    return {
      ...error,
      failureType,
      retryable,
      suggestedStrategy,
    };
  }

  setTimeout(ms: number): void {
    this.config.timeoutMs = ms;
  }

  getConfig(): ExecutorConfig {
    return { ...this.config };
  }
}

export function createAgentExecutor(config?: Partial<ExecutorConfig>): AgentExecutor {
  return new AgentExecutor(config);
}
