import { EventEmitter } from 'events';
import {
  ProviderDriver,
  ProviderRegistryEntry,
  ProviderCapability,
  ProviderType,
  ExecutionRequest,
  RawProviderOutput,
} from './provider-types.js';
import { AnthropicDriver, OpenAIDriver } from './drivers-api.js';
import { OllamaDriver } from './drivers-local.js';

export interface ProviderSelectionContext {
  taskId: string;
  requiredCapabilities: ProviderCapability[];
  preferredType?: ProviderType;
  maxLatencyMs?: number;
  preferOffline?: boolean;
}

export interface ProviderSelectionResult {
  provider: ProviderRegistryEntry;
  fallback?: ProviderRegistryEntry;
}

export interface ProviderExecutionLog {
  providerId: string;
  taskId: string;
  success: boolean;
  latencyMs: number;
  error?: string;
  timestamp: number;
}

export interface RegistryConfig {
  enableFallback: boolean;
  healthCheckIntervalMs: number;
}

const DEFAULT_REGISTRY_CONFIG: RegistryConfig = {
  enableFallback: true,
  healthCheckIntervalMs: 60000,
};

export class ProviderRegistry extends EventEmitter {
  private providers: Map<string, ProviderRegistryEntry> = new Map();
  private executionLogs: ProviderExecutionLog[] = [];
  private config: RegistryConfig;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<RegistryConfig>) {
    super();
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    await this.registerFromConfig({
      id: 'api:anthropic',
      name: 'Anthropic API',
      type: 'api',
      capabilities: ['code_generation', 'system_design', 'reasoning', 'documentation', 'testing', 'code_review', 'refactoring'],
      config: { model: 'claude-sonnet-4-20250514' },
      costWeight: 0.8,
    });

    await this.registerFromConfig({
      id: 'api:openai',
      name: 'OpenAI API',
      type: 'api',
      capabilities: ['code_generation', 'system_design', 'reasoning', 'documentation', 'testing'],
      config: { model: 'gpt-4o' },
      costWeight: 0.9,
    });

    await this.registerFromConfig({
      id: 'local:ollama',
      name: 'Ollama Local',
      type: 'local',
      capabilities: ['code_generation', 'reasoning', 'documentation'],
      config: { model: 'llama3', baseUrl: 'http://localhost:11434' },
      costWeight: 0.0,
    });

    this.startHealthChecks();
  }

  private async registerFromConfig(config: { id: string; name: string; type: ProviderType; capabilities: ProviderCapability[]; config: Record<string, unknown>; costWeight: number }): Promise<void> {
    let driver: ProviderDriver | null = null;

    switch (config.id) {
      case 'api:anthropic':
        driver = new AnthropicDriver();
        break;
      case 'api:openai':
        driver = new OpenAIDriver();
        break;
      case 'local:ollama':
        driver = new OllamaDriver();
        break;
      default:
        console.warn(`Unknown provider: ${config.id}`);
        return;
    }

    if (!driver) {
      return;
    }

    await driver.initialize(config.config);

    const entry: ProviderRegistryEntry = {
      id: config.id,
      name: config.name,
      type: config.type,
      capabilities: config.capabilities,
      driver,
      health: {
        status: 'offline',
        avgLatencyMs: 0,
        successRate: 0,
        lastChecked: 0,
      },
      costWeight: config.costWeight,
      isActive: true,
    };

    this.providers.set(config.id, entry);
    this.emit('provider.registered', entry);
  }

  async register(id: string, driver: ProviderDriver, capabilities: ProviderCapability[], costWeight: number = 0.5): Promise<void> {
    const entry: ProviderRegistryEntry = {
      id,
      name: driver.name,
      type: driver.type,
      capabilities,
      driver,
      health: {
        status: 'offline',
        avgLatencyMs: 0,
        successRate: 0,
        lastChecked: 0,
      },
      costWeight,
      isActive: true,
    };

    this.providers.set(id, entry);
    await driver.initialize({});
    await this.updateHealth(id);

    this.emit('provider.registered', entry);
  }

  async unregister(id: string): Promise<void> {
    const entry = this.providers.get(id);
    if (!entry) return;

    await entry.driver.terminate();
    this.providers.delete(id);

    this.emit('provider.unregistered', id);
  }

  get(id: string): ProviderRegistryEntry | undefined {
    return this.providers.get(id);
  }

  getAll(): ProviderRegistryEntry[] {
    return Array.from(this.providers.values());
  }

  getByType(type: ProviderType): ProviderRegistryEntry[] {
    return this.getAll().filter(p => p.type === type);
  }

  getByCapability(capability: ProviderCapability): ProviderRegistryEntry[] {
    return this.getAll().filter(p => p.capabilities.includes(capability));
  }

  async select(context: ProviderSelectionContext): Promise<ProviderSelectionResult | null> {
    const candidates = this.findCandidates(context);

    if (candidates.length === 0) {
      return null;
    }

    const scored = this.scoreProviders(candidates, context);
    scored.sort((a, b) => b.score - a.score);

    const primary = scored[0]?.provider;
    const fallback = this.config.enableFallback && scored.length > 1 ? scored[1]?.provider : undefined;

    if (!primary) {
      return null;
    }

    return {
      provider: primary,
      fallback,
    };
  }

  private findCandidates(context: ProviderSelectionContext): ProviderRegistryEntry[] {
    const candidates: ProviderRegistryEntry[] = [];

    for (const provider of this.getAll()) {
      if (!provider.isActive) continue;
      if (!this.hasRequiredCapabilities(provider, context.requiredCapabilities)) continue;
      if (context.preferredType && provider.type !== context.preferredType) continue;
      if (context.preferOffline && provider.type === 'api') continue;

      candidates.push(provider);
    }

    return candidates;
  }

  private hasRequiredCapabilities(provider: ProviderRegistryEntry, required: ProviderCapability[]): boolean {
    if (required.length === 0) return true;
    return required.every(cap => provider.capabilities.includes(cap));
  }

  private scoreProviders(candidates: ProviderRegistryEntry[], context: ProviderSelectionContext): Array<{ provider: ProviderRegistryEntry; score: number }> {
    return candidates.map(provider => {
      let score = 0;

      const health = provider.health;
      if (health.status === 'healthy') score += 30;
      else if (health.status === 'degraded') score += 10;

      if (health.successRate >= 0.9) score += 20;
      else if (health.successRate >= 0.7) score += 10;

      if (context.maxLatencyMs && health.avgLatencyMs < context.maxLatencyMs) {
        score += 10;
      }

      score -= provider.costWeight * 10;

      for (const cap of context.requiredCapabilities) {
        if (provider.capabilities.includes(cap)) {
          score += 5;
        }
      }

      return { provider, score };
    });
  }

  async execute(providerId: string, request: ExecutionRequest, fallbackId?: string): Promise<RawProviderOutput> {
    const primary = this.providers.get(providerId);
    if (!primary) {
      throw new Error(`Provider ${providerId} not found`);
    }

    const startTime = Date.now();

    try {
      const result = await primary.driver.execute(request);
      const latency = Date.now() - startTime;

      this.logExecution({
        providerId,
        taskId: request.taskId,
        success: true,
        latencyMs: latency,
        timestamp: Date.now(),
      });

      this.updateHealthStats(providerId, latency, true);
      this.emit('provider.execution.success', { providerId, taskId: request.taskId, latency });

      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logExecution({
        providerId,
        taskId: request.taskId,
        success: false,
        latencyMs: latency,
        error: errorMessage,
        timestamp: Date.now(),
      });

      this.updateHealthStats(providerId, latency, false);
      this.emit('provider.execution.failure', { providerId, taskId: request.taskId, error: errorMessage });

      if (fallbackId && this.config.enableFallback) {
        const fallback = this.providers.get(fallbackId);
        if (fallback && fallback.isActive) {
          this.emit('provider.fallback', { primary: providerId, fallback: fallbackId, taskId: request.taskId });
          return this.execute(fallbackId, request);
        }
      }

      throw error;
    }
  }

  private logExecution(log: ProviderExecutionLog): void {
    this.executionLogs.push(log);

    if (this.executionLogs.length > 10000) {
      this.executionLogs = this.executionLogs.slice(-5000);
    }
  }

  private updateHealthStats(providerId: string, latencyMs: number, success: boolean): void {
    const entry = this.providers.get(providerId);
    if (!entry) return;

    const health = entry.health;
    const newSuccessRate = success
      ? (health.successRate * 0.9 + 0.1)
      : (health.successRate * 0.9);

    const newLatency = success
      ? (health.avgLatencyMs * 0.9 + latencyMs * 0.1)
      : health.avgLatencyMs;

    entry.health = {
      ...health,
      successRate: newSuccessRate,
      avgLatencyMs: Math.round(newLatency),
      lastChecked: Date.now(),
    };
  }

  async updateHealth(providerId: string): Promise<void> {
    const entry = this.providers.get(providerId);
    if (!entry) return;

    try {
      const health = await entry.driver.healthCheck();
      entry.health = health;
      this.emit('provider.health.updated', { providerId, health });
    } catch {
      entry.health = {
        status: 'offline',
        avgLatencyMs: 0,
        successRate: 0,
        lastChecked: Date.now(),
      };
    }
  }

  private async healthCheckLoop(): Promise<void> {
    for (const entry of this.getAll()) {
      if (entry.isActive) {
        await this.updateHealth(entry.id);
      }
    }
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(
      () => this.healthCheckLoop(),
      this.config.healthCheckIntervalMs
    );
  }

  getExecutionLogs(providerId?: string, limit: number = 100): ProviderExecutionLog[] {
    const logs = providerId
      ? this.executionLogs.filter(l => l.providerId === providerId)
      : this.executionLogs;

    return logs.slice(-limit);
  }

  getSuccessRate(providerId: string): number {
    const logs = this.executionLogs.filter(l => l.providerId === providerId);
    if (logs.length === 0) return 0;

    const successCount = logs.filter(l => l.success).length;
    return successCount / logs.length;
  }

  getAverageLatency(providerId: string): number {
    const logs = this.executionLogs.filter(l => l.providerId === providerId);
    if (logs.length === 0) return 0;

    const totalLatency = logs.reduce((sum, l) => sum + l.latencyMs, 0);
    return totalLatency / logs.length;
  }

  setActive(id: string, isActive: boolean): void {
    const entry = this.providers.get(id);
    if (entry) {
      entry.isActive = isActive;
      this.emit('provider.active', { providerId: id, isActive });
    }
  }

  close(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    for (const [id] of this.providers) {
      this.providers.get(id)?.driver.terminate();
    }

    this.removeAllListeners();
  }
}

let globalRegistry: ProviderRegistry | null = null;

export function getProviderRegistry(): ProviderRegistry {
  if (!globalRegistry) {
    globalRegistry = new ProviderRegistry();
  }
  return globalRegistry;
}

export async function initProviderRegistry(config?: Partial<RegistryConfig>): Promise<ProviderRegistry> {
  const registry = new ProviderRegistry(config);
  await registry.initialize();
  globalRegistry = registry;
  return registry;
}