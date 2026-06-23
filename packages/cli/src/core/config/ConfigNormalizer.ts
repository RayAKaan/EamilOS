import { parse } from 'yaml';
import * as fs from 'fs';

export interface NormalizedProvider {
  id: string;
  type: string;
  endpoint?: string;
  models: Array<{
    id: string;
    contextWindow?: number;
    maxTokens?: number;
  }>;
}

export interface NormalizedConfig {
  providers: NormalizedProvider[];
  defaultProvider: string;
  defaultModel: string;
  routing?: Record<string, unknown>;
  features?: Record<string, unknown>;
  plugins?: Record<string, unknown>;
  debug?: boolean;
  version?: number;
  workspace?: Record<string, unknown>;
  budget?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  logging?: Record<string, unknown>;
}

export class ConfigNormalizer {
  private warnings: string[] = [];

  normalize(raw: Record<string, unknown>): NormalizedConfig {
    this.warnings = [];

    const format = this.detectFormat(raw);
    let providers: NormalizedProvider[];
    let defaultProvider: string;
    let defaultModel: string;

    switch (format) {
      case 'nested': {
        providers = this.parseNestedProviders(raw);
        defaultProvider = this.findDefaultProvider(raw, providers);
        defaultModel = this.findDefaultModel(raw, providers);
        break;
      }

      case 'flat': {
        providers = this.parseFlatFormat(raw);
        defaultProvider = this.findDefaultProvider(raw, providers);
        defaultModel = this.findDefaultModel(raw, providers);
        break;
      }

      case 'minimal': {
        providers = this.parseMinimalFormat(raw);
        defaultProvider = (raw.provider as string) || 'ollama';
        defaultModel = (raw.model as string) || 'phi3:mini';
        break;
      }

      default: {
        this.warnings.push('Config format not recognized — using defaults');
        providers = [{
          id: 'ollama',
          type: 'ollama',
          models: [{ id: 'phi3:mini' }],
        }];
        defaultProvider = 'ollama';
        defaultModel = 'phi3:mini';
      }
    }

    if (providers.length === 0) {
      this.warnings.push('No providers found in config — adding Ollama as default');
      providers = [{
        id: 'ollama',
        type: 'ollama',
        models: [{ id: 'phi3:mini' }],
      }];
      defaultProvider = 'ollama';
      defaultModel = 'phi3:mini';
    }

    for (const provider of providers) {
      if (!provider.models || provider.models.length === 0) {
        this.warnings.push(
          `Provider '${provider.id}' has no models — ` +
          'will attempt auto-detection at runtime'
        );
        provider.models = [];
      }
    }

    if (this.warnings.length > 0) {
      for (const w of this.warnings) {
        console.warn(`  \u26a0\ufe0f  Config: ${w}`);
      }
    }

    return {
      providers,
      defaultProvider,
      defaultModel,
      routing: this.extractRouting(raw),
      features: (raw.features as Record<string, unknown>) || undefined,
      plugins: (raw.plugins as Record<string, unknown>) || undefined,
      debug: raw.debug === true,
      version: raw.version as number | undefined,
      workspace: raw.workspace as Record<string, unknown> | undefined,
      budget: raw.budget as Record<string, unknown> | undefined,
      settings: raw.settings as Record<string, unknown> | undefined,
      logging: raw.logging as Record<string, unknown> | undefined,
    };
  }

  private detectFormat(raw: Record<string, unknown>): 'nested' | 'flat' | 'minimal' | 'unknown' {
    const hasProviders = Array.isArray(raw.providers);
    const hasTopLevelModels = Array.isArray(raw.models);
    const hasSimpleProvider = typeof raw.provider === 'string';
    const hasSimpleModel = typeof raw.model === 'string';

    if (hasProviders && hasTopLevelModels) return 'flat';

    if (hasProviders) {
      const providers = raw.providers as Array<Record<string, unknown>>;
      const anyHasModels = providers.some(
        (p) => Array.isArray(p.models) && (p.models as unknown[]).length > 0
      );
      if (anyHasModels) return 'nested';
      if (hasSimpleModel) return 'minimal';
      return 'nested';
    }

    if (hasSimpleProvider || hasSimpleModel) return 'minimal';

    return 'unknown';
  }

  private parseNestedProviders(raw: Record<string, unknown>): NormalizedProvider[] {
    const rawProviders = raw.providers as Array<Record<string, unknown>>;
    const result: NormalizedProvider[] = [];

    for (const rp of rawProviders) {
      if (!rp.id || !rp.type) {
        this.warnings.push('Skipping provider with missing id or type');
        continue;
      }

      const models: Array<{ id: string; contextWindow?: number; maxTokens?: number }> = [];

      if (Array.isArray(rp.models)) {
        for (const rm of rp.models as Array<Record<string, unknown>>) {
          if (!rm.id) {
            this.warnings.push(`Skipping model with missing id in provider '${rp.id}'`);
            continue;
          }
          models.push({
            id: rm.id as string,
            contextWindow: rm.context_window as number | undefined,
            maxTokens: rm.max_tokens as number | undefined,
          });
        }
      }

      result.push({
        id: rp.id as string,
        type: rp.type as string,
        endpoint: rp.endpoint as string | undefined,
        models,
      });
    }

    return result;
  }

  private parseFlatFormat(raw: Record<string, unknown>): NormalizedProvider[] {
    const providers = this.parseNestedProviders(raw);

    const topModels = raw.models as Array<Record<string, unknown>> | undefined;
    if (!topModels) return providers;

    for (const rm of topModels) {
      if (!rm.id) {
        this.warnings.push('Skipping model with missing id');
        continue;
      }

      const providerRef = rm.provider as string;
      if (!providerRef) {
        this.warnings.push(`Model '${rm.id}' has no provider reference — skipping`);
        continue;
      }

      let targetProvider = providers.find((p) => p.id === providerRef);

      if (!targetProvider) {
        this.warnings.push(
          `Model '${rm.id}' references provider '${providerRef}' which ` +
          "isn't declared — creating provider automatically"
        );
        targetProvider = {
          id: providerRef,
          type: providerRef,
          models: [],
        };
        providers.push(targetProvider);
      }

      targetProvider.models.push({
        id: rm.id as string,
        contextWindow: (rm.context_window as number) || undefined,
        maxTokens: (rm.max_tokens as number) || undefined,
      });
    }

    return providers;
  }

  private parseMinimalFormat(raw: Record<string, unknown>): NormalizedProvider[] {
    const providerStr = (raw.provider as string) || 'ollama';
    const modelStr = (raw.model as string) || 'phi3:mini';

    const providerType = this.inferProviderType(providerStr);

    return [{
      id: providerStr,
      type: providerType,
      endpoint: providerType === 'ollama' ? 'http://localhost:11434' : undefined,
      models: [{ id: modelStr }],
    }];
  }

  private inferProviderType(provider: string): string {
    const lower = provider.toLowerCase();
    if (lower.includes('ollama')) return 'ollama';
    if (lower.includes('openai') || lower.includes('gpt')) return 'openai';
    if (lower.includes('anthropic') || lower.includes('claude')) return 'anthropic';
    return lower;
  }

  private findDefaultProvider(
    raw: Record<string, unknown>,
    providers: NormalizedProvider[]
  ): string {
    if (typeof raw.default_provider === 'string') return raw.default_provider;
    if (typeof raw.provider === 'string') return raw.provider;

    const withModels = providers.find((p) => p.models.length > 0);
    if (withModels) return withModels.id;

    if (providers.length > 0) return providers[0].id;

    return 'ollama';
  }

  private findDefaultModel(
    raw: Record<string, unknown>,
    providers: NormalizedProvider[]
  ): string {
    if (typeof raw.default_model === 'string') return raw.default_model;
    if (typeof raw.model === 'string') return raw.model;

    for (const p of providers) {
      if (p.models.length > 0) return p.models[0].id;
    }

    return 'phi3:mini';
  }

  private extractRouting(raw: Record<string, unknown>): Record<string, unknown> | undefined {
    if (raw.routing) return raw.routing as Record<string, unknown>;

    return {
      mode: 'auto',
      default_tier: 'cheap',
      task_routing: {},
      fallback_order: [],
      exploration_rate: 0.1,
      minimum_data_points: 5,
      overrides: {},
      default_model: this.findDefaultModel(raw, []),
      default_provider: this.findDefaultProvider(raw, []),
    };
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  static loadAndNormalize(configPath: string): NormalizedConfig {
    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const raw = parse(content) as Record<string, unknown>;
    const normalizer = new ConfigNormalizer();
    return normalizer.normalize(raw);
  }
}
