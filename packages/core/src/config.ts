import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { ConfigSchema, EamilOSConfig } from './schemas/config.js';
import { NormalizedConfig } from './config/ConfigNormalizer.js';
import { AutoInit } from './config/AutoInit.js';

export class ConfigLoader {
  private config: EamilOSConfig | null = null;
  private configPath: string;

  constructor(configPath: string = 'eamilos.yaml') {
    this.configPath = configPath;
  }

  private getSearchPaths(): string[] {
    const paths = [
      this.configPath,
      'eamilos.yaml',
      '.eamilos.yaml',
      'eamilos.config.yaml',
      '.eamilos.config.yaml',
    ];
    return paths;
  }

  private findConfigFile(): string | null {
    for (const p of this.getSearchPaths()) {
      if (existsSync(p)) {
        return p;
      }
    }
    return null;
  }

  async load(): Promise<EamilOSConfig> {
    if (this.config) {
      return this.config;
    }

    const foundPath = this.findConfigFile();

    if (!foundPath) {
      return await this.loadAutoInitConfig();
    }

    const content = readFileSync(foundPath, 'utf-8');
    const resolved = this.resolveEnvVars(content);
    const parsed = parse(resolved) as unknown;

    const result = ConfigSchema.safeParse(parsed);

    if (!result.success) {
      const errors = result.error.errors.map(
        (e) => `  - ${e.path.join('.')}: ${e.message}`
      );
      throw new Error(
        `Config validation failed:\n${errors.join('\n')}`
      );
    }

    this.config = result.data;
    return this.config;
  }

  private async loadAutoInitConfig(): Promise<EamilOSConfig> {
    console.log('\n  📋 No configuration found — auto-detecting environment...\n');

    const autoInit = new AutoInit();
    const result = await autoInit.autoInit();

    if (result.errors.length > 0) {
      for (const e of result.errors) {
        console.log(`  ❌ ${e}`);
      }
      console.log('\n  To get started, choose one:\n');
      console.log('  Option A — Local (free, private):');
      console.log('    curl -fsSL https://ollama.ai/install.sh | sh');
      console.log('    ollama pull phi3:mini');
      console.log('');
      console.log('  Option B — Cloud (powerful, paid):');
      console.log('    export OPENAI_API_KEY=sk-your-key-here');
      console.log('');
      process.exit(1);
    }

    console.log(`  ✅ Configuration created: ${result.configPath}`);
    console.log(`     Provider: ${result.provider}`);
    console.log(`     Model: ${result.model}`);

    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        console.log(`     ⚠️  ${w}`);
      }
    }
    console.log('');

    return this.convertNormalizedToSchema(result.config);
  }

  private convertNormalizedToSchema(normalized: NormalizedConfig): EamilOSConfig {
    const routing = normalized.routing;
    const hasRouting = !!routing;
    const routingData = hasRouting ? routing : { task_routing: {}, fallback_order: [], exploration_rate: 0.1, minimum_data_points: 5 };
    
    const taskRouting = (routingData.task_routing as Record<string, 'cheap' | 'strong'>) || {};
    const fbOrder = routingData.fallback_order;
    const fallbackOrder: string[] = (fbOrder && Array.isArray(fbOrder) && fbOrder.length > 0) 
      ? fbOrder as string[]
      : [normalized.defaultProvider];
    const overrides: Record<string, string> = (routingData.overrides as Record<string, string>) || {};
    const explorationRate = typeof routingData.exploration_rate === 'number' ? routingData.exploration_rate : 0.1;
    const minimumDataPoints = typeof routingData.minimum_data_points === 'number' ? routingData.minimum_data_points : 5;

    return {
      version: 1,
      providers: normalized.providers.map(p => ({
        id: p.id,
        type: p.type as 'openai' | 'ollama' | 'anthropic' | 'google' | 'custom',
        endpoint: p.endpoint,
        models: p.models.map(m => ({
          id: m.id,
          tier: 'cheap' as const,
          context_window: m.contextWindow || 8192,
        })),
      })),
      routing: {
        mode: (routing?.mode as 'auto' | 'manual' | 'hybrid') || 'auto',
        default_tier: (routing?.default_tier as 'cheap' | 'strong') || 'cheap',
        task_routing: taskRouting,
        fallback_order: fallbackOrder,
        exploration_rate: explorationRate,
        minimum_data_points: minimumDataPoints,
        overrides: overrides,
        default_model: normalized.defaultModel,
        default_provider: normalized.defaultProvider,
      },
      workspace: {
        base_dir: './data/projects',
        git_enabled: true,
        max_file_size_mb: 10,
        max_workspace_size_mb: 500,
      },
      budget: {
        max_tokens_per_task: 50000,
        max_cost_per_project_usd: 5.0,
        warn_at_percentage: 80,
      },
      settings: {
        max_parallel_tasks: 3,
        task_timeout_seconds: 300,
        model_call_timeout_seconds: 120,
        preview_mode: true,
        auto_retry: true,
      },
      logging: {
        level: 'info',
        console: true,
        file: undefined,
        max_file_size_mb: 50,
        max_files: 5,
        live: true,
      },
    };
  }

  private resolveEnvVars(content: string): string {
    return content.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
      const value = process.env[varName];
      if (value === undefined) {
        console.warn(`Warning: Environment variable ${varName} is not set`);
        return '';
      }
      return value;
    });
  }

  get(): EamilOSConfig {
    if (!this.config) {
      throw new Error('Config not loaded. Call load() first.');
    }
    return this.config;
  }
}

let globalConfig: EamilOSConfig | null = null;

export async function loadConfig(configPath?: string): Promise<EamilOSConfig> {
  if (globalConfig) {
    return globalConfig;
  }
  const loader = new ConfigLoader(configPath);
  globalConfig = await loader.load();
  return globalConfig;
}

export function getConfig(): EamilOSConfig {
  if (!globalConfig) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return globalConfig;
}
