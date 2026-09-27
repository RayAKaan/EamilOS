import type { DecisionContext, JevProviderResponse } from './types.js';
import { JevDecisionSchema } from './types.js';
import type { JevProvider } from './types.js';

export interface JevHttpProviderOptions {
  endpoint: string;
  apiKey: string;
  timeoutMs?: number;
  healthEndpoint?: string;
  headers?: Record<string, string>;
}

export class JevHttpProvider implements JevProvider {
  readonly id = 'jev-http';

  constructor(private readonly options: JevHttpProviderOptions) {
    if (!options.endpoint) throw new Error('Jev endpoint is required');
    if (!options.apiKey) throw new Error('Jev API key is required');
  }

  async decide(context: DecisionContext): Promise<JevProviderResponse> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60_000);

    try {
      const response = await fetch(this.options.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
          ...(this.options.headers ?? {}),
        },
        body: JSON.stringify(context),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Jev request failed (${response.status}): ${text.slice(0, 500)}`);

      const payload = JSON.parse(text) as Record<string, unknown>;
      const rawDecision = payload.decision ?? payload;
      const decision = JevDecisionSchema.parse(rawDecision);
      return {
        decision,
        provider: typeof payload.provider === 'string' ? payload.provider : this.id,
        model: typeof payload.model === 'string' ? payload.model : undefined,
        usage: typeof payload.usage === 'object' && payload.usage !== null
          ? payload.usage as JevProviderResponse['usage']
          : undefined,
        latencyMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async health(): Promise<{ healthy: boolean; error?: string }> {
    if (!this.options.healthEndpoint) return { healthy: true };
    try {
      const response = await fetch(this.options.healthEndpoint, {
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          ...(this.options.headers ?? {}),
        },
      });
      return response.ok ? { healthy: true } : { healthy: false, error: `HTTP ${response.status}` };
    } catch (error) {
      return { healthy: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
