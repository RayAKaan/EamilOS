import { EventEmitter } from 'events';
import {
  ProviderConfig,
  LLMProvider,
  ProviderStatus,
  InitializationResult,
  ModelInfo,
  ChatMessage,
  ToolDefinition,
  ChatRequest,
  ChatResponse,
} from './types.js';
import { ProviderFactory } from './ProviderFactory.js';
import { ProviderAutoDetect } from './ProviderAutoDetect.js';
import { ExplainableError } from '../errors/ExplainableError.js';
import { OllamaAdapter } from './adapters/OllamaAdapter.js';
import { Phase1ModelRegistry } from '../models/Phase1ModelRegistry.js';
import { ProviderCircuitBreaker } from './ProviderCircuitBreaker.js';
import { getTypedEventBus } from '../events/TypedEventBus.js';
import { getConfig } from '../config.js';

export interface LLMRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  providerId?: string;
}

export type ProviderResponse = ChatResponse;

export interface ProviderInfo {
  id: string;
  type: string;
  model: string;
  available: boolean;
  supportsTools: boolean;
}

export class ProviderManager extends EventEmitter {
  private providers: Map<string, LLMProvider> = new Map();
  private providerStatuses: Map<string, ProviderStatus> = new Map();
  private circuitBreaker: ProviderCircuitBreaker;

  private healthScores: Map<string, number> = new Map();
  private failureCounts: Map<string, number> = new Map();
  private lastUsed: Map<string, number> = new Map();
  private disabledProviders: Set<string> = new Set();

  private defaultProvider: string | null = null;

  constructor(circuitBreaker?: ProviderCircuitBreaker) {
    super();
    this.circuitBreaker = circuitBreaker || new ProviderCircuitBreaker();
  }

  registerProvider(providerId: string, provider: LLMProvider): void {
    this.providers.set(providerId, provider);
    this.healthScores.set(providerId, 100);
    this.failureCounts.set(providerId, 0);

    if (!this.defaultProvider) {
      this.defaultProvider = providerId;
    }
  }

  updateProviderHealth(providerId: string, success: boolean, latencyMs: number): void {
    const currentScore = this.healthScores.get(providerId) ?? 100;
    const penalty = success ? Math.max(0, (latencyMs - 1000) / 10) : 30;

    const newScore = success
      ? Math.min(100, currentScore + (10 - penalty))
      : Math.max(0, currentScore - penalty);

    this.healthScores.set(providerId, newScore);
    this.failureCounts.set(providerId, success ? 0 : (this.failureCounts.get(providerId) ?? 0) + 1);
    this.lastUsed.set(providerId, Date.now());

    this.emit('provider:healthUpdate', { providerId, score: newScore });

    if ((this.failureCounts.get(providerId) ?? 0) > 5) {
      this.disableProvider(providerId);
    }
  }

  getHealthScore(providerId: string): number {
    return this.healthScores.get(providerId) ?? 100;
  }

  private disableProvider(providerId: string): void {
    if (this.providers.has(providerId)) {
      this.disabledProviders.add(providerId);
      this.emit('provider:disabled', { providerId, reason: 'excessive_failures' });
    }
  }

  async initialize(config: ProviderConfig[]): Promise<InitializationResult> {
    let configuredProviders = config;

    if (configuredProviders.length === 0) {
      console.log('No providers configured - auto-detecting...');
      const detected = await ProviderAutoDetect.detect();

      if (detected.length > 0) {
        console.log(`Auto-detected ${detected.length} provider(s):`);
        for (const d of detected) {
          console.log(`  - ${d.id} (${d.engine})`);
          if (d.models && d.models.length > 0) {
            console.log(`    Models: ${d.models.slice(0, 5).join(', ')}${d.models.length > 5 ? '...' : ''}`);
          }
        }
        configuredProviders = detected;
      }
    }

    const adapters: LLMProvider[] = [];
    for (const provConfig of configuredProviders) {
      try {
        const adapter = ProviderFactory.create(provConfig);
        adapters.push(adapter);
      } catch (error) {
        console.warn(
          `Failed to create adapter for '${provConfig.id}': ${error instanceof Error ? error.message : error}`
        );
      }
    }

    const healthResults: ProviderStatus[] = [];

    for (const adapter of adapters) {
      const cbState = this.circuitBreaker.getStateInfo(adapter.id);

      if (!cbState.available) {
        const status: ProviderStatus = {
          id: adapter.id,
          type: adapter.type,
          engine: adapter.engine,
          available: false,
          latencyMs: 0,
          issues: [
            {
              severity: 'warning',
              code: 'CIRCUIT_OPEN',
              message: `Provider '${adapter.id}' is circuit-broken.`,
              fix: ['Waiting for cooldown period to expire.'],
              autoFixable: false,
            },
          ],
          models: [],
          capabilities: { chat: false, streaming: false, embeddings: false, functionCalling: false },
          lastChecked: new Date(),
          score: 0,
        };
        healthResults.push(status);
        this.providerStatuses.set(adapter.id, status);
        continue;
      }

      let status = await adapter.healthCheck();

      if (!status.available && status.issues.some((i) => i.autoFixable)) {
        const fixResult = await this.attemptAutoFix(adapter, status);
        if (fixResult.success) {
          status = await adapter.healthCheck();
        }
      }

      status.models = status.models.map((m) => ({
        ...m,
        ...Phase1ModelRegistry.getMetadata(m.name),
      }));

      status.score = this.calculateProviderScore(status);
      status.successRate = cbState.successRate;
      status.errorRate = cbState.errorRate;
      status.avgLatency = cbState.avgLatency;
      status.totalRequests = cbState.totalRequests;

      healthResults.push(status);
      this.providerStatuses.set(adapter.id, status);

      if (status.available) {
        this.providers.set(adapter.id, adapter);
        this.healthScores.set(adapter.id, Math.max(1, status.score || 100));
        this.failureCounts.set(adapter.id, 0);
        if (!this.defaultProvider) {
          this.defaultProvider = adapter.id;
        }
      }
    }

    const available = healthResults.filter((p) => p.available);
    const failed = healthResults.filter((p) => !p.available);

    if (available.length === 0) {
      throw new ExplainableError({
        code: 'NO_PROVIDER_AVAILABLE',
        severity: 'fatal',
        title: 'No Usable AI Providers Found',
        message: 'EamilOS checked all configured providers and none are available.',
        details: failed.map((p) => ({
          provider: `${p.id} (${p.type}/${p.engine})`,
          problems: p.issues.map((i) => i.message),
        })),
        fixes: [
          'Option 1 - Local: Install Ollama -> https://ollama.ai, then run "ollama serve"',
          'Option 2 - Cloud: Add an API key to .env (GROQ_API_KEY, DEEPSEEK_API_KEY, etc.)',
          'Option 3 - Custom: Point to any OpenAI-compatible endpoint in eamilos.yaml',
          'Option 4 - Guided: Run "eamilos setup" for interactive configuration',
        ],
      });
    }

    for (const f of failed) {
      console.warn(`Provider '${f.id}' unavailable: ${f.issues[0]?.message}`);
    }

    return {
      providers: available.map((p) => this.providers.get(p.id)!).filter(Boolean),
      failed,
      totalConfigured: healthResults.length,
      totalAvailable: available.length,
    };
  }

  getProvider(id?: string): LLMProvider | undefined {
    const resolved = id || this.defaultProvider || undefined;
    return resolved ? this.providers.get(resolved) : undefined;
  }

  getProviderStatus(id: string): ProviderStatus | undefined {
    return this.providerStatuses.get(id);
  }

  getAllStatuses(): ProviderStatus[] {
    return Array.from(this.providerStatuses.values());
  }

  getProviders(): ProviderInfo[] {
    return this.getAllStatuses().map((status) => ({
      id: status.id,
      type: status.engine,
      model: status.models[0]?.name || 'unknown',
      available: status.available && !this.disabledProviders.has(status.id),
      supportsTools: status.capabilities.functionCalling,
    }));
  }

  getProviderInfo(id: string): ProviderInfo | null {
    return this.getProviders().find((provider) => provider.id === id) ?? null;
  }

  async checkAvailability(id: string): Promise<boolean> {
    const provider = this.providers.get(id);
    if (!provider || this.disabledProviders.has(id)) {
      return false;
    }
    try {
      await provider.healthCheck();
      return true;
    } catch {
      return false;
    }
  }

  supportsTools(providerId?: string): boolean {
    const id = providerId || this.defaultProvider;
    if (!id) return false;
    const status = this.providerStatuses.get(id);
    return status?.capabilities.functionCalling ?? false;
  }

  async chat(
    messages: import('../types.js').ChatMessage[],
    _tools?: ToolDefinition[],
    providerId?: string
  ): Promise<{
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  }> {
    const request: LLMRequest = {
      messages: messages as unknown as ChatMessage[],
      providerId,
    };
    const response = await this.routeWithFallback(request);
    return {
      content: response.content,
      toolCalls: undefined,
    };
  }

  async routeWithFallback(request: LLMRequest, maxFallbacks = 3): Promise<ProviderResponse> {
    let currentProviderId = await this.selectProvider(request);
    const errors: string[] = [];

    for (let i = 0; i <= maxFallbacks; i++) {
      try {
        if (i > 0) {
          currentProviderId = await this.selectFallbackProvider(request, errors);
        }
        const started = Date.now();
        const response = await this.executeProviderRequest(currentProviderId, request);
        this.updateProviderHealth(currentProviderId, true, Date.now() - started);
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${currentProviderId}: ${message}`);
        this.updateProviderHealth(currentProviderId, false, 0);
        continue;
      }
    }

    throw new Error(`All providers failed: ${errors.join('; ')}`);
  }

  private async selectProvider(request: LLMRequest): Promise<string> {
    if (request.providerId && this.providers.has(request.providerId) && !this.disabledProviders.has(request.providerId)) {
      return request.providerId;
    }

    const sorted = Array.from(this.providers.keys())
      .filter((id) => !this.disabledProviders.has(id))
      .sort((a, b) => this.getHealthScore(b) - this.getHealthScore(a));

    if (sorted.length === 0) {
      throw new Error('No providers available');
    }

    return sorted[0];
  }

  private async selectFallbackProvider(request: LLMRequest, previousErrors: string[]): Promise<string> {
    const primary = request.providerId ? [request.providerId] : [];
    const available = Array.from(this.providers.entries())
      .filter(([id]) => !this.disabledProviders.has(id))
      .filter(([id]) => !primary.includes(id))
      .filter(([id]) => !previousErrors.some((e) => e.startsWith(`${id}:`)))
      .sort((a, b) => this.getHealthScore(b[0]) - this.getHealthScore(a[0]));

    if (available.length === 0) throw new Error('No fallback providers available');
    return available[0][0];
  }

  private async executeProviderRequest(providerId: string, request: LLMRequest): Promise<ProviderResponse> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    const modelFromStatus = this.providerStatuses.get(providerId)?.models[0]?.name;
    const model = request.model || modelFromStatus || 'unknown';

    const chatRequest: ChatRequest = {
      model,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      timeout: request.timeout,
      stream: request.stream,
    };

    return provider.chat(chatRequest);
  }

  findProviderForModel(model: string): string | null {
    for (const [providerId, status] of this.providerStatuses) {
      if (!status.available || this.disabledProviders.has(providerId)) continue;
      if (status.models.some((m) => m.name === model)) {
        return providerId;
      }
    }
    return null;
  }

  getProviderWithModel(providerId: string, model: string): string | null {
    const status = this.providerStatuses.get(providerId);
    if (!status || !status.available || this.disabledProviders.has(providerId)) return null;
    if (status.models.some((m) => m.name === model)) {
      return providerId;
    }
    return null;
  }

  getBestAvailableModel(
    preferTags?: string[],
    filterFn?: (status: ProviderStatus) => boolean
  ): { model: string; provider: string } | null {
    let bestMatch: { model: string; provider: string; score: number } | null = null;

    for (const [providerId, status] of this.providerStatuses) {
      if (!status.available || this.disabledProviders.has(providerId)) continue;
      if (!this.circuitBreaker.isAvailable(providerId)) continue;
      if (filterFn && !filterFn(status)) continue;

      for (const model of status.models) {
        let modelScore = status.score;

        if (preferTags && model.tags) {
          const matchCount = preferTags.filter((t) => (model.tags as string[]).includes(t)).length;
          modelScore += matchCount * 15;
        }

        if (!bestMatch || modelScore > bestMatch.score) {
          bestMatch = { model: model.name, provider: providerId, score: modelScore };
        }
      }
    }

    return bestMatch ? { model: bestMatch.model, provider: bestMatch.provider } : null;
  }

  recordSuccess(providerId: string, latencyMs: number = 0): void {
    this.circuitBreaker.recordSuccess(providerId, latencyMs);
    this.updateProviderHealth(providerId, true, latencyMs);
    this.updateStatusMetrics(providerId);
  }

  recordFailure(providerId: string, latencyMs: number = 0): void {
    this.circuitBreaker.recordFailure(providerId, latencyMs);
    this.updateProviderHealth(providerId, false, latencyMs);
    this.updateStatusMetrics(providerId);

    const state = this.circuitBreaker.getStateInfo(providerId);
    if (state.blocked) {
      const eventBus = getTypedEventBus();
      eventBus.emit('provider:circuit-opened', {
        providerId,
        reason: `Too many failures (${state.failures})`,
      });
    }
  }

  private updateStatusMetrics(providerId: string): void {
    const status = this.providerStatuses.get(providerId);
    if (!status) return;

    const state = this.circuitBreaker.getStateInfo(providerId);
    status.successRate = state.successRate;
    status.errorRate = state.errorRate;
    status.avgLatency = state.avgLatency;
    status.totalRequests = state.totalRequests;
    status.score = this.calculateProviderScore(status);
  }

  private calculateProviderScore(status: ProviderStatus): number {
    let score = 0;

    if (status.available) score += 50;

    if (status.avgLatency !== undefined) {
      if (status.avgLatency < 200) score += 20;
      else if (status.avgLatency < 1000) score += 10;
    } else if (status.latencyMs < 100) {
      score += 30;
    } else if (status.latencyMs < 500) {
      score += 20;
    } else if (status.latencyMs < 2000) {
      score += 10;
    }

    if (status.successRate !== undefined) {
      score += status.successRate * 30;
    }

    if (status.errorRate !== undefined) {
      score += (1 - status.errorRate) * 20;
    }

    if (status.models.length > 0) score += 10;
    if (status.issues.filter((i) => i.severity === 'warning').length === 0) score += 10;

    return Math.min(100, score);
  }

  private async attemptAutoFix(
    adapter: LLMProvider,
    status: ProviderStatus
  ): Promise<{ success: boolean; action?: string }> {
    const ollamaIssue = status.issues.find((i) => i.code === 'LOCAL_SERVICE_NOT_RUNNING');
    if (ollamaIssue && adapter instanceof OllamaAdapter) {
      console.log(`  Auto-fixing ${adapter.id}: Starting Ollama service...`);
      const success = await adapter.attemptAutoStart();
      if (success) {
        console.log(`  Fixed ${adapter.id}: Ollama service started`);
        return { success: true, action: 'Started Ollama service' };
      }
    }

    return { success: false };
  }

  async listModelsForProvider(providerId: string): Promise<ModelInfo[]> {
    const provider = this.providers.get(providerId);
    if (!provider) return [];

    const status = this.providerStatuses.get(providerId);
    if (status?.models) return status.models;

    return provider.listModels();
  }

  getCircuitBreakerState(providerId: string) {
    return this.circuitBreaker.getStateInfo(providerId);
  }

  resetCircuitBreaker(providerId?: string): void {
    if (providerId) {
      this.circuitBreaker.reset(providerId);
      this.failureCounts.set(providerId, 0);
      this.disabledProviders.delete(providerId);
    } else {
      this.circuitBreaker.resetAll();
      this.failureCounts.clear();
      this.disabledProviders.clear();
    }
  }
}

let globalProviderManager: ProviderManager | null = null;

async function bootstrapFromConfig(manager: ProviderManager): Promise<void> {
  try {
    const cfg = getConfig();
    if (!cfg?.providers || cfg.providers.length === 0) {
      return;
    }

    const providerConfig: ProviderConfig[] = cfg.providers.map((p) => ({
      id: p.id,
      type: p.type === 'ollama' ? 'local' : p.type === 'openai' ? 'api' : 'openai-compatible',
      engine: p.type,
      baseUrl: p.endpoint || p.base_url,
      credentials: {
        apiKey: p.api_key || p.credentials?.api_key,
        token: p.credentials?.token,
        headers: p.credentials?.headers,
        organization: p.credentials?.organization,
      },
      models: p.models?.map((m) => m.id) || [],
      rateLimitRpm: p.rate_limit_rpm,
    }));

    await manager.initialize(providerConfig);
  } catch {
    // Keep lazy behavior: runtime can still initialize later.
  }
}

export function initProviderManager(): ProviderManager {
  globalProviderManager = new ProviderManager();
  void bootstrapFromConfig(globalProviderManager);
  return globalProviderManager;
}

export function getProviderManager(): ProviderManager {
  if (!globalProviderManager) {
    return initProviderManager();
  }
  return globalProviderManager;
}

export function resetProviderManager(): void {
  globalProviderManager = null;
}
