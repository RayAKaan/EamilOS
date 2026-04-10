import { getProviderReadiness, ReadinessResult, ProviderStatus } from './ProviderReadiness.js';
import { getConfig } from '../config.js';

export interface ExecutionPlan {
  provider: string;
  model: string;
  mode: 'local' | 'cloud';
  fallbackProvider?: string;
  fallbackModel?: string;
}

export interface ExecutionContext {
  task: string;
  plan: ExecutionPlan;
  attempt: number;
  maxAttempts: number;
}

export class ExecutionGuarantee {
  private readiness = getProviderReadiness();
  private debugMode = false;

  constructor(debugMode = false) {
    this.debugMode = debugMode;
  }

  async prepareExecution(): Promise<{
    ready: boolean;
    plan: ExecutionPlan | null;
    result: ReadinessResult;
  }> {
    const result = await this.readiness.validate();

    if (!result.ready) {
      return {
        ready: false,
        plan: null,
        result,
      };
    }

    const plan = this.createExecutionPlan(result.primary!);
    return {
      ready: true,
      plan,
      result,
    };
  }

  private createExecutionPlan(primary: ProviderStatus): ExecutionPlan {
    const config = getConfig();
    const defaultProvider = config.routing?.default_provider || primary.id;
    const defaultModel = config.routing?.default_model || primary.recommendedModel;

    return {
      provider: defaultProvider,
      model: defaultModel || this.readiness.getDefaultModelForProvider(primary.type),
      mode: primary.type === 'ollama' ? 'local' : 'cloud',
      fallbackProvider: this.getFallbackProvider(primary),
      fallbackModel: this.readiness.getFallbackModels()[0],
    };
  }

  private getFallbackProvider(current: ProviderStatus): string | undefined {
    if (current.type === 'ollama' && process.env.OPENAI_API_KEY) {
      return 'openai';
    }
    if (current.type === 'openai' && process.env.ANTHROPIC_API_KEY) {
      return 'anthropic';
    }
    return undefined;
  }

  async executeWithGuarantee<T>(
    task: string,
    executor: (ctx: ExecutionContext) => Promise<T>,
    options?: { maxRetries?: number; onFallback?: (from: string, to: string) => void }
  ): Promise<T> {
    const maxRetries = options?.maxRetries ?? 3;
    let lastError: Error | null = null;

    const prep = await this.prepareExecution();

    if (!prep.ready) {
      throw this.createExplainableError(prep.result);
    }

    const ctx: ExecutionContext = {
      task,
      plan: prep.plan!,
      attempt: 1,
      maxAttempts: maxRetries,
    };

    this.printStartupInfo(prep.plan!);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      ctx.attempt = attempt;

      try {
        if (this.debugMode) {
          console.log(`\n  ⚡ Attempt ${attempt}/${maxRetries}`);
        }

        const result = await executor(ctx);
        this.printSuccessInfo();
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (this.debugMode) {
          console.log(`  ❌ Attempt ${attempt} failed: ${lastError.message}`);
        }

        if (attempt < maxRetries && ctx.plan.fallbackProvider) {
          const fromProvider = ctx.plan.provider;
          ctx.plan.provider = ctx.plan.fallbackProvider;
          ctx.plan.model = this.readiness.getDefaultModelForProvider(ctx.plan.provider);
          ctx.plan.mode = 'cloud';

          if (options?.onFallback) {
            options.onFallback(fromProvider, ctx.plan.provider);
          }

          if (this.debugMode) {
            console.log(`  ↻ Falling back to: ${ctx.plan.provider}/${ctx.plan.model}`);
          }
        }
      }
    }

    throw lastError || new Error('Execution failed after all retries');
  }

  private createExplainableError(result: ReadinessResult): Error {
    const lines = ['Unable to run AI task.'];

    lines.push('\nDetected:');
    for (const provider of result.providers) {
      const status = provider.installed ? 'yes' : 'no';
      const running = provider.running ? 'yes' : 'no';
      lines.push(`  • ${provider.type}: installed=${status}, running=${running}`);
    }

    lines.push('\nFix:');
    for (const fix of result.fixes) {
      lines.push(`  ${fix}`);
    }

    return new Error(lines.join('\n'));
  }

  private printStartupInfo(plan: ExecutionPlan): void {
    console.log('');
    console.log(`  ✔ Using provider: ${plan.provider}`);
    console.log(`  ✔ Model: ${plan.model}`);
    console.log(`  ✔ Mode: ${plan.mode}`);
    console.log('');
  }

  private printSuccessInfo(): void {
    console.log('');
    console.log('  ✔ Task completed');
    console.log('');
  }

  printProviderStatus(result: ReadinessResult): void {
    console.log('\n  Provider Status:');
    for (const provider of result.providers) {
      const statusIcon = provider.running && provider.modelsAvailable ? '✔' : '✘';
      const status = provider.running && provider.modelsAvailable ? 'ready' : 'not ready';
      console.log(`  ${statusIcon} ${provider.type}: ${status}`);
      if (provider.models.length > 0) {
        console.log(`     Models: ${provider.models.slice(0, 5).join(', ')}${provider.models.length > 5 ? '...' : ''}`);
      }
    }
    console.log('');
  }
}

let globalGuarantee: ExecutionGuarantee | null = null;

export function getExecutionGuarantee(debugMode = false): ExecutionGuarantee {
  if (!globalGuarantee || globalGuarantee['debugMode'] !== debugMode) {
    globalGuarantee = new ExecutionGuarantee(debugMode);
  }
  return globalGuarantee;
}
