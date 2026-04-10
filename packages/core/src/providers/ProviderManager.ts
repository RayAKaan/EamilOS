import {
  ProviderConfig,
  LLMProvider,
  ProviderStatus,
  InitializationResult,
  ModelInfo,
} from "./types.js";
import { ProviderFactory } from "./ProviderFactory.js";
import { ProviderAutoDetect } from "./ProviderAutoDetect.js";
import { ExplainableError } from "../errors/ExplainableError.js";
import { OllamaAdapter } from "./adapters/OllamaAdapter.js";
import { Phase1ModelRegistry } from "../models/Phase1ModelRegistry.js";
import {
  ProviderCircuitBreaker,
} from "./ProviderCircuitBreaker.js";
import { getTypedEventBus } from "../events/TypedEventBus.js";

export class ProviderManager {
  private providers: Map<string, LLMProvider> = new Map();
  private providerStatuses: Map<string, ProviderStatus> = new Map();
  private circuitBreaker: ProviderCircuitBreaker;

  constructor(circuitBreaker?: ProviderCircuitBreaker) {
    this.circuitBreaker = circuitBreaker || new ProviderCircuitBreaker();
  }

  async initialize(config: ProviderConfig[]): Promise<InitializationResult> {
    let configuredProviders = config;

    if (configuredProviders.length === 0) {
      console.log("No providers configured — auto-detecting...");
      const detected = await ProviderAutoDetect.detect();

      if (detected.length > 0) {
        console.log(`Auto-detected ${detected.length} provider(s):`);
        for (const d of detected) {
          console.log(`  - ${d.id} (${d.engine})`);
          if (d.models && d.models.length > 0) {
            console.log(`    Models: ${d.models.slice(0, 5).join(", ")}${d.models.length > 5 ? "..." : ""}`);
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
        console.warn(`Failed to create adapter for '${provConfig.id}': ${error instanceof Error ? error.message : error}`);
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
              severity: "warning",
              code: "CIRCUIT_OPEN",
              message: `Provider '${adapter.id}' is circuit-broken.`,
              fix: ["Waiting for cooldown period to expire."],
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
      }
    }

    const available = healthResults.filter((p) => p.available);
    const failed = healthResults.filter((p) => !p.available);

    if (available.length === 0) {
      throw new ExplainableError({
        code: "NO_PROVIDER_AVAILABLE",
        severity: "fatal",
        title: "No Usable AI Providers Found",
        message:
          "EamilOS checked all configured providers and none are available.",
        details: failed.map((p) => ({
          provider: `${p.id} (${p.type}/${p.engine})`,
          problems: p.issues.map((i) => i.message),
        })),
        fixes: [
          "Option 1 — Local: Install Ollama → https://ollama.ai, then run 'ollama serve'",
          "Option 2 — Cloud: Add an API key to .env (GROQ_API_KEY, DEEPSEEK_API_KEY, etc.)",
          "Option 3 — Custom: Point to any OpenAI-compatible endpoint in eamilos.yaml",
          "Option 4 — Guided: Run 'eamilos setup' for interactive configuration",
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

  getProvider(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  getProviderStatus(id: string): ProviderStatus | undefined {
    return this.providerStatuses.get(id);
  }

  getAllStatuses(): ProviderStatus[] {
    return Array.from(this.providerStatuses.values());
  }

  findProviderForModel(model: string): string | null {
    for (const [providerId, status] of this.providerStatuses) {
      if (!status.available) continue;
      if (status.models.some((m) => m.name === model)) {
        return providerId;
      }
    }
    return null;
  }

  getProviderWithModel(providerId: string, model: string): string | null {
    const status = this.providerStatuses.get(providerId);
    if (!status || !status.available) return null;
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
      if (!status.available) continue;
      if (!this.circuitBreaker.isAvailable(providerId)) continue;
      if (filterFn && !filterFn(status)) continue;

      for (const model of status.models) {
        let modelScore = status.score;

        if (preferTags && model.tags) {
          const matchCount = preferTags.filter((t) =>
            (model.tags as string[]).includes(t)
          ).length;
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
    this.updateStatusMetrics(providerId);
  }

  recordFailure(providerId: string, latencyMs: number = 0): void {
    this.circuitBreaker.recordFailure(providerId, latencyMs);
    this.updateStatusMetrics(providerId);

    const state = this.circuitBreaker.getStateInfo(providerId);
    if (state.blocked) {
      const eventBus = getTypedEventBus();
      eventBus.emit("provider:circuit-opened", {
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
    if (status.issues.filter((i) => i.severity === "warning").length === 0)
      score += 10;

    return Math.min(100, score);
  }

  private async attemptAutoFix(
    adapter: LLMProvider,
    status: ProviderStatus
  ): Promise<{ success: boolean; action?: string }> {
    const ollamaIssue = status.issues.find(
      (i) => i.code === "LOCAL_SERVICE_NOT_RUNNING"
    );
    if (ollamaIssue && adapter instanceof OllamaAdapter) {
      console.log(`  Auto-fixing ${adapter.id}: Starting Ollama service...`);
      const success = await adapter.attemptAutoStart();
      if (success) {
        console.log(`  Fixed ${adapter.id}: Ollama service started`);
        return { success: true, action: "Started Ollama service" };
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
    } else {
      this.circuitBreaker.resetAll();
    }
  }
}

let globalProviderManager: ProviderManager | null = null;

export function initProviderManager(): ProviderManager {
  globalProviderManager = new ProviderManager();
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
