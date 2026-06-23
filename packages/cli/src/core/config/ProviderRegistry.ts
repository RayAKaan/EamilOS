import { createOllamaProvider, LLMProvider } from '../providers/ollama.js';
import { createOpenAIProvider } from '../providers/openai.js';
import type { NormalizedConfig, NormalizedProvider } from './ConfigNormalizer.js';

export interface ProviderInstance {
  id: string;
  type: string;
  provider: LLMProvider;
  defaultModel: string;
  availableModels: string[];
}

export interface ProviderRegistryResult {
  providers: Map<string, ProviderInstance>;
  defaultProvider: string;
  defaultModel: string;
  errors: string[];
}

export class ProviderRegistry {
  private registry: Map<string, ProviderInstance> = new Map();
  private defaultProviderId: string = '';
  private defaultModelId: string = '';
  private errors: string[] = [];

  initialize(config: NormalizedConfig): ProviderRegistryResult {
    this.registry.clear();
    this.errors = [];
    this.defaultProviderId = config.defaultProvider;
    this.defaultModelId = config.defaultModel;

    for (const providerConfig of config.providers) {
      this.registerProvider(providerConfig);
    }

    if (this.registry.size === 0) {
      this.errors.push(
        'No providers could be initialized from config. ' +
        'Run "eamilos setup" or ensure Ollama is running.'
      );
    }

    return {
      providers: this.registry,
      defaultProvider: this.defaultProviderId,
      defaultModel: this.defaultModelId,
      errors: this.errors,
    };
  }

  private registerProvider(providerConfig: NormalizedProvider): void {
    try {
      switch (providerConfig.type) {
        case 'ollama':
          this.registerOllama(providerConfig);
          break;
        case 'openai':
          this.registerOpenAI(providerConfig);
          break;
        default:
          this.errors.push(
            `Unknown provider type '${providerConfig.type}' for provider '${providerConfig.id}'. ` +
            'Supported types: ollama, openai'
          );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.errors.push(
        `Failed to initialize provider '${providerConfig.id}': ${message}`
      );
    }
  }

  private registerOllama(providerConfig: NormalizedProvider): void {
    const endpoint = providerConfig.endpoint || 'http://localhost:11434';
    const models = providerConfig.models.map((m) => m.id);
    const defaultModel = models[0] || 'phi3:mini';

    const provider = createOllamaProvider(endpoint, defaultModel);

    this.registry.set(providerConfig.id, {
      id: providerConfig.id,
      type: 'ollama',
      provider,
      defaultModel,
      availableModels: models,
    });
  }

  private registerOpenAI(providerConfig: NormalizedProvider): void {
    const apiKey = (providerConfig as unknown as Record<string, unknown>).api_key as string | undefined;
    
    if (!apiKey) {
      this.errors.push(
        `OpenAI provider '${providerConfig.id}' is missing 'api_key'. ` +
        'Set the OPENAI_API_KEY environment variable or add api_key to your config.'
      );
      return;
    }

    const models = providerConfig.models.map((m) => m.id);
    const defaultModel = models[0] || 'gpt-4o-mini';

    const provider = createOpenAIProvider(apiKey, defaultModel);

    this.registry.set(providerConfig.id, {
      id: providerConfig.id,
      type: 'openai',
      provider,
      defaultModel,
      availableModels: models,
    });
  }

  getProvider(id?: string): LLMProvider | null {
    const providerId = id || this.defaultProviderId;
    const instance = this.registry.get(providerId);
    return instance?.provider || null;
  }

  getProviderInstance(id?: string): ProviderInstance | null {
    const providerId = id || this.defaultProviderId;
    return this.registry.get(providerId) || null;
  }

  getAllProviders(): ProviderInstance[] {
    return Array.from(this.registry.values());
  }

  hasProvider(id?: string): boolean {
    const providerId = id || this.defaultProviderId;
    return this.registry.has(providerId);
  }

  getDefaultProviderId(): string {
    return this.defaultProviderId;
  }

  getDefaultModel(): string {
    return this.defaultModelId;
  }

  getErrors(): string[] {
    return [...this.errors];
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  async checkHealth(id?: string): Promise<{ available: boolean; latency?: number; error?: string }> {
    const providerId = id || this.defaultProviderId;
    const instance = this.registry.get(providerId);

    if (!instance) {
      return {
        available: false,
        error: `Provider '${providerId}' not found`,
      };
    }

    const start = Date.now();
    try {
      await instance.provider.chatSimple('ping');
      return {
        available: true,
        latency: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        available: false,
        latency: Date.now() - start,
        error: message,
      };
    }
  }

  static async fromConfig(config: NormalizedConfig): Promise<ProviderRegistryResult> {
    const registry = new ProviderRegistry();
    return registry.initialize(config);
  }

  static async fromConfigPath(configPath: string): Promise<ProviderRegistryResult> {
    const { ConfigNormalizer } = await import('./ConfigNormalizer.js');
    const normalized = ConfigNormalizer.loadAndNormalize(configPath);
    return ProviderRegistry.fromConfig(normalized);
  }
}

let globalRegistry: ProviderRegistry | null = null;

export function getProviderRegistry(): ProviderRegistry {
  if (!globalRegistry) {
    globalRegistry = new ProviderRegistry();
  }
  return globalRegistry;
}

export function initProviderRegistry(config: NormalizedConfig): ProviderRegistryResult {
  const registry = getProviderRegistry();
  return registry.initialize(config);
}
