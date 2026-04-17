import { ApiDriver } from './driver-base.js';
import {
  ExecutionRequest,
  RawProviderOutput,
  ProviderCapability,
  ProviderHealth,
} from './provider-types.js';

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

export class AnthropicDriver extends ApiDriver {
  id = 'api:anthropic';
  name = 'Anthropic Claude';
  type = 'api' as const;
  capabilities: ProviderCapability[] = [
    'code_generation',
    'system_design',
    'reasoning',
    'documentation',
    'testing',
    'code_review',
    'refactoring',
  ];

  async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);
  }

  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    try {
      const apiKey = this.getApiKey('ANTHROPIC_API_KEY');
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.getConfig('model', ANTHROPIC_MODEL),
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });

      const latency = Date.now() - startTime;

      return {
        status: response.ok ? 'healthy' : 'degraded',
        avgLatencyMs: latency,
        successRate: response.ok ? 1.0 : 0.0,
        lastChecked: Date.now(),
      };
    } catch {
      return {
        status: 'offline',
        avgLatencyMs: Date.now() - startTime,
        successRate: 0.0,
        lastChecked: Date.now(),
      };
    }
  }

  async execute(request: ExecutionRequest): Promise<RawProviderOutput> {
    this.ensureInitialized();

    const startTime = Date.now();
    const apiKey = this.getApiKey('ANTHROPIC_API_KEY');
    const model = this.getConfig('model', ANTHROPIC_MODEL);
    const maxTokens = request.constraints?.maxTokens || 8192;
    const timeout = request.constraints?.timeoutMs || 120000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: request.prompt }],
        }),
      });

      clearTimeout(timeoutId);

      const latency = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        content: Array<{ text: string }>;
        usage: { input_tokens: number; output_tokens: number };
      };

      return {
        providerId: this.id,
        rawText: data.content[0]?.text || '',
        metadata: {
          model,
          latencyMs: latency,
          tokenUsage: {
            input: data.usage.input_tokens,
            output: data.usage.output_tokens,
          },
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}

export class OpenAIDriver extends ApiDriver {
  id = 'api:openai';
  name = 'OpenAI GPT';
  type = 'api' as const;
  capabilities: ProviderCapability[] = [
    'code_generation',
    'system_design',
    'reasoning',
    'documentation',
    'testing',
  ];

  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    try {
      const apiKey = this.getApiKey('OPENAI_API_KEY');
      const response = await fetch('https://api.openai.com/v1/models/gpt-4o', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      const latency = Date.now() - startTime;

      return {
        status: response.ok ? 'healthy' : 'degraded',
        avgLatencyMs: latency,
        successRate: response.ok ? 1.0 : 0.0,
        lastChecked: Date.now(),
      };
    } catch {
      return {
        status: 'offline',
        avgLatencyMs: Date.now() - startTime,
        successRate: 0.0,
        lastChecked: Date.now(),
      };
    }
  }

  async execute(request: ExecutionRequest): Promise<RawProviderOutput> {
    this.ensureInitialized();

    const startTime = Date.now();
    const apiKey = this.getApiKey('OPENAI_API_KEY');
    const model = this.getConfig('model', 'gpt-4o');
    const maxTokens = request.constraints?.maxTokens || 8192;
    const timeout = request.constraints?.timeoutMs || 120000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: request.prompt }],
          max_tokens: maxTokens,
        }),
      });

      clearTimeout(timeoutId);

      const latency = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number };
      };

      return {
        providerId: this.id,
        rawText: data.choices[0]?.message.content || '',
        metadata: {
          model,
          latencyMs: latency,
          tokenUsage: {
            input: data.usage.prompt_tokens,
            output: data.usage.completion_tokens,
          },
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}