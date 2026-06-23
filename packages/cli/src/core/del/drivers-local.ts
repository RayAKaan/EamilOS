import { LocalDriver } from './driver-base.js';
import {
  ExecutionRequest,
  RawProviderOutput,
  ProviderCapability,
  ProviderHealth,
} from './provider-types.js';

export class OllamaDriver extends LocalDriver {
  id = 'local:ollama';
  name = 'Ollama Local';
  type = 'local' as const;
  capabilities: ProviderCapability[] = [
    'code_generation',
    'reasoning',
    'documentation',
  ];

  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/tags`);
      const latency = Date.now() - startTime;

      if (!response.ok) {
        return {
          status: 'degraded',
          avgLatencyMs: latency,
          successRate: 0.5,
          lastChecked: Date.now(),
        };
      }

      return {
        status: 'healthy',
        avgLatencyMs: latency,
        successRate: 1.0,
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
    const model = this.getModel();
    const timeout = request.constraints?.timeoutMs || 120000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.getBaseUrl()}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          prompt: request.prompt,
          stream: false,
        }),
      });

      clearTimeout(timeoutId);

      const latency = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { response: string; prompt_eval_count?: number; eval_count?: number };

      return {
        providerId: this.id,
        rawText: data.response,
        metadata: {
          model,
          latencyMs: latency,
          tokenUsage: {
            input: data.prompt_eval_count || 0,
            output: data.eval_count || data.response.length / 4,
          },
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}