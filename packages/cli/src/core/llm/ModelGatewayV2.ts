export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
}

export interface ModelChunk {
  kind: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'status' | 'final' | 'error';
  text?: string;
  tool?: string;
  data?: Record<string, unknown>;
  usage?: ModelUsage;
}

export interface ModelRequestV2 {
  id: string;
  sessionId: string;
  prompt: string;
  systemPrompt?: string;
  workingDir: string;
  signal?: AbortSignal;
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface ModelProvider {
  readonly id: string;
  readonly models?: readonly string[];
  stream(request: ModelRequestV2): AsyncIterable<ModelChunk>;
}

export interface ModelRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly retryable?: (error: unknown) => boolean;
}

export interface ModelRun {
  readonly provider: string;
  readonly model?: string;
  readonly stream: AsyncIterable<ModelChunk>;
}

export class ModelGatewayV2 {
  private readonly providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider): () => void {
    if (this.providers.has(provider.id)) throw new Error(`Model provider already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
    return () => this.providers.delete(provider.id);
  }

  get(provider: string): ModelProvider | undefined {
    return this.providers.get(provider);
  }

  list(): string[] {
    return [...this.providers.keys()].sort();
  }

  run(request: ModelRequestV2, retry: ModelRetryPolicy = {
    maxAttempts: 2,
    baseDelayMs: 250,
    maxDelayMs: 2_000,
  }): ModelRun {
    const providerId = request.provider ?? this.list()[0];
    if (!providerId) throw new Error('No model providers registered');
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown model provider: ${providerId}`);

    const stream = this.retryingStream(provider, request, retry);
    return { provider: provider.id, model: request.model, stream };
  }

  private async *retryingStream(
    provider: ModelProvider,
    request: ModelRequestV2,
    policy: ModelRetryPolicy,
  ): AsyncIterable<ModelChunk> {
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        yield* provider.stream(request);
        return;
      } catch (error) {
        const retryable = policy.retryable?.(error) ?? true;
        if (!retryable || attempt >= Math.max(1, policy.maxAttempts) || request.signal?.aborted) throw error;
        const delay = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** (attempt - 1)));
        yield { kind: 'status', text: `Model provider retrying (attempt ${attempt + 1})` };
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          request.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Model execution cancelled'));
          }, { once: true });
        });
      }
    }
  }
}
