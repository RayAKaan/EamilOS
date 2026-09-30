export interface ModelTextChunk {
  kind: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'status' | 'final' | 'error';
  text?: string;
  tool?: string;
  data?: Record<string, unknown>;
}

export interface ModelRequest {
  id: string;
  sessionId: string;
  prompt: string;
  systemPrompt?: string;
  workingDir: string;
  signal?: AbortSignal;
}

export interface ModelStream {
  readonly provider: string;
  readonly model?: string;
  stream(request: ModelRequest): AsyncIterable<ModelTextChunk>;
}

export class ModelGateway {
  private readonly providers = new Map<string, ModelStream>();

  register(provider: string, stream: ModelStream): () => void {
    if (this.providers.has(provider)) throw new Error(`Model provider already registered: ${provider}`);
    this.providers.set(provider, stream);
    return () => this.providers.delete(provider);
  }

  get(provider: string): ModelStream | undefined {
    return this.providers.get(provider);
  }

  list(): string[] {
    return [...this.providers.keys()];
  }
}
