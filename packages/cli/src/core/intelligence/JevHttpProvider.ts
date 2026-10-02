import type { DecisionContext, JevProviderResponse } from './types.js';
import type { JevProvider } from './types.js';
import { JevDecisionSchema } from './types.js';
import { ContextHasher } from './ContextHasher.js';
import { ContextSanitizer } from './ContextSanitizer.js';
import { JevDecisionMapper } from './JevDecisionMapper.js';
import { JevQuestionBuilder } from './JevQuestionBuilder.js';
import { JevSystemOneResponseSchema, type JevSystemOneOptions } from './JevSystemOneTypes.js';

export interface JevHttpProviderOptions extends JevSystemOneOptions {}

function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 529;
}

export class JevHttpProvider implements JevProvider {
  readonly id = 'jev-http';
  private readonly sanitizer = new ContextSanitizer();
  private readonly builder = new JevQuestionBuilder();
  private readonly mapper = new JevDecisionMapper();

  constructor(private readonly options: JevHttpProviderOptions) {
    if (!options.endpoint) throw new Error('Jev endpoint is required');
    if (!options.apiKey) throw new Error('Jev API key is required');
  }

  async decide(context: DecisionContext): Promise<JevProviderResponse> {
    const started = Date.now();
    const sanitized = this.sanitizer.sanitize(context);
    const contextHash = ContextHasher.hash(sanitized);
    const build = this.builder.build(sanitized);
    const payload = {
      model: this.options.model ?? 'jev-latest',
      state: build.state,
      questions: build.questions,
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= (this.options.maxRetries ?? 2); attempt += 1) {
      try {
        const response = await this.request(payload);
        const parsed = JevSystemOneResponseSchema.parse(response);
        const usage = parsed.usage;
        const inputTokens = usage?.input_tokens;
        const costUsd = usage?.cost;
        const totalTokens = usage?.total_tokens ?? ((inputTokens ?? 0) + (usage?.output_tokens ?? 0));
        if (this.options.maxTokens !== undefined && totalTokens > this.options.maxTokens) {
          const budgetError = new Error('Jev token budget exceeded.');
          (budgetError as Error & { retryable?: boolean }).retryable = false;
          throw budgetError;
        }
        if (this.options.maxCostUsd !== undefined && costUsd !== undefined && costUsd > this.options.maxCostUsd) {
          throw new Error('Jev cost budget exceeded.');
        }
        const mapped = this.mapper.map(sanitized, contextHash, parsed, build.targetTaskIds, build.candidateAgentIds);
        const decision = JevDecisionSchema.parse(mapped.decision);
        return {
          decision,
          provider: this.id,
          model: parsed.model,
          usage: {
            inputTokens,
            outputTokens: usage?.output_tokens,
            totalTokens,
            costUsd,
          },
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        lastError = error;
        if (attempt >= (this.options.maxRetries ?? 2) || !this.shouldRetry(error)) throw error;
        const retryAfter = error && typeof error === 'object' && 'retryAfterMs' in error
          ? (error as { retryAfterMs?: number }).retryAfterMs
          : undefined;
        const exponential = Math.min(this.options.maxBackoffMs ?? 5000, (this.options.baseBackoffMs ?? 250) * 2 ** attempt);
        await sleep(Math.min(this.options.maxBackoffMs ?? 5000, retryAfter ?? exponential));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Jev request failed.');
  }

  async health(): Promise<{ healthy: boolean; error?: string }> {
    try {
      const endpoint = this.options.healthEndpoint ?? this.modelsEndpoint();
      const response = await this.fetch(endpoint, { method: 'GET' }, Math.min(this.options.timeoutMs ?? 60000, 5000));
      if (!response.ok) return { healthy: false, error: 'HTTP ' + response.status };
      return { healthy: true };
    } catch (error) {
      return { healthy: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async request(payload: unknown): Promise<unknown> {
    const endpoint = this.options.endpoint;
    const response = await this.fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + this.options.apiKey,
        ...(this.options.headers ?? {}),
      },
      body: JSON.stringify(payload),
    }, this.options.timeoutMs ?? 60000);
    if (!response.ok) {
      const retryable = retryableStatus(response.status);
      const retryAfter = retryAfterMs(response.headers.get('retry-after'));
      await response.text();
      const error = new Error('Jev HTTP ' + response.status);
      (error as Error & { retryable?: boolean; retryAfterMs?: number }).retryable = retryable;
      (error as Error & { retryable?: boolean; retryAfterMs?: number }).retryAfterMs = retryAfter;
      throw error;
    }
    return response.json();
  }

  private async fetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        const timeout = new Error('Jev request timed out.');
        (timeout as Error & { retryable?: boolean }).retryable = true;
        throw timeout;
      }
      throw error;
    } finally { clearTimeout(timer); }
  }

  private shouldRetry(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'retryable' in error && (error as { retryable?: boolean }).retryable);
  }

  private modelsEndpoint(): string {
    const endpoint = this.options.endpoint.replace(/\/v1\/systemone\/?$/, '');
    return endpoint + '/v1/models';
  }
}
