import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse as yamlParse } from 'yaml';
import { OllamaDetector } from '../providers/OllamaDetector.js';
import { ConfigWriter } from './ConfigWriter.js';

export interface HealResult {
  healed: boolean;
  changes: HealChange[];
  backupPath?: string;
  error?: string;
}

export interface HealChange {
  field: string;
  before: unknown;
  after: unknown;
  reason: string;
}

export class ConfigHealer {
  private detector: OllamaDetector;

  constructor() {
    this.detector = new OllamaDetector();
  }

  async heal(configPath: string, dryRun: boolean = false): Promise<HealResult> {
    const result: HealResult = {
      healed: false,
      changes: [],
    };

    if (!fs.existsSync(configPath)) {
      result.error = `Config file not found: ${configPath}`;
      return result;
    }

    let rawConfig: Record<string, unknown>;
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      rawConfig = yamlParse(content) as Record<string, unknown>;
    } catch (e) {
      result.error = `Invalid YAML: ${e instanceof Error ? e.message : String(e)}`;
      return result;
    }

    const ollamaStatus = await this.detector.detect();

    if (!rawConfig.provider && !rawConfig.providers) {
      if (ollamaStatus.running && ollamaStatus.models.length > 0) {
        result.changes.push({
          field: 'provider',
          before: undefined,
          after: 'ollama',
          reason: 'Added default provider since Ollama is running',
        });
        rawConfig.provider = 'ollama';
      } else if (process.env.OPENAI_API_KEY) {
        result.changes.push({
          field: 'provider',
          before: undefined,
          after: 'openai',
          reason: 'Added OpenAI as provider since API key is set',
        });
        rawConfig.provider = 'openai';
      }
    }

    if (!rawConfig.model && !rawConfig.models) {
      if (ollamaStatus.running && ollamaStatus.recommended) {
        result.changes.push({
          field: 'model',
          before: undefined,
          after: ollamaStatus.recommended,
          reason: `Added recommended Ollama model: ${ollamaStatus.recommended}`,
        });
        rawConfig.model = ollamaStatus.recommended;
      } else if (rawConfig.provider === 'openai') {
        result.changes.push({
          field: 'model',
          before: undefined,
          after: 'gpt-4o-mini',
          reason: 'Added default OpenAI model',
        });
        rawConfig.model = 'gpt-4o-mini';
      } else {
        result.changes.push({
          field: 'model',
          before: undefined,
          after: 'phi3:mini',
          reason: 'Added fallback model',
        });
        rawConfig.model = 'phi3:mini';
      }
    }

    if (ollamaStatus.running && ollamaStatus.models.length > 0) {
      const currentModel = (rawConfig.model as string) || '';
      const hasModel = ollamaStatus.models.some((m) => m.name === currentModel);

      if (currentModel && !hasModel) {
        result.changes.push({
          field: 'model',
          before: currentModel,
          after: ollamaStatus.recommended || ollamaStatus.models[0].name,
          reason: `Current model "${currentModel}" not installed, switching to available model`,
        });
        rawConfig.model = ollamaStatus.recommended || ollamaStatus.models[0].name;
      }
    }

    if (!rawConfig.routing) {
      result.changes.push({
        field: 'routing',
        before: undefined,
        after: { mode: 'auto', default_tier: 'cheap' },
        reason: 'Added default routing configuration',
      });
      rawConfig.routing = {
        mode: 'auto',
        default_tier: 'cheap',
        task_routing: {},
        fallback_order: [],
        exploration_rate: 0.1,
        minimum_data_points: 5,
        overrides: {},
      };
    }

    if (!rawConfig.features) {
      result.changes.push({
        field: 'features',
        before: undefined,
        after: { self_healing_routing: { enabled: true } },
        reason: 'Added default features configuration',
      });
      rawConfig.features = {
        self_healing_routing: {
          enabled: true,
          failure_threshold: 3,
          cooldown_minutes: 30,
        },
        adaptive_prompting: {
          enabled: true,
          strategy: 'per_model',
        },
      };
    }

    if (!rawConfig.workspace) {
      result.changes.push({
        field: 'workspace',
        before: undefined,
        after: { base_dir: './data/projects' },
        reason: 'Added default workspace configuration',
      });
      rawConfig.workspace = {
        base_dir: './data/projects',
        git_enabled: true,
        max_file_size_mb: 10,
        max_workspace_size_mb: 500,
      };
    }

    if (!rawConfig.budget) {
      result.changes.push({
        field: 'budget',
        before: undefined,
        after: { max_tokens_per_task: 50000, max_cost_per_project_usd: 5.0 },
        reason: 'Added default budget configuration',
      });
      rawConfig.budget = {
        max_tokens_per_task: 50000,
        max_cost_per_project_usd: 5.0,
        warn_at_percentage: 80,
      };
    }

    if (!rawConfig.settings) {
      result.changes.push({
        field: 'settings',
        before: undefined,
        after: { max_parallel_tasks: 3, task_timeout_seconds: 300 },
        reason: 'Added default settings',
      });
      rawConfig.settings = {
        max_parallel_tasks: 3,
        task_timeout_seconds: 300,
        model_call_timeout_seconds: 120,
        preview_mode: true,
        auto_retry: true,
      };
    }

    if (!rawConfig.logging) {
      result.changes.push({
        field: 'logging',
        before: undefined,
        after: { level: 'info', console: true, live: true },
        reason: 'Added default logging configuration',
      });
      rawConfig.logging = {
        level: 'info',
        console: true,
        live: true,
      };
    }

    if (result.changes.length === 0) {
      return result;
    }

    result.healed = true;

    if (!dryRun) {
      const backupPath = configPath + '.backup.' + Date.now();
      fs.copyFileSync(configPath, backupPath);
      result.backupPath = backupPath;

      ConfigWriter.write(rawConfig, configPath);
    }

    return result;
  }

  static async heal(configPath: string, dryRun: boolean = false): Promise<HealResult> {
    const healer = new ConfigHealer();
    return healer.heal(configPath, dryRun);
  }

  static async findAndHeal(dryRun: boolean = false): Promise<HealResult> {
    const configPath = ConfigHealer.findConfig();
    if (!configPath) {
      return {
        healed: false,
        changes: [],
        error: 'No config file found',
      };
    }
    return ConfigHealer.heal(configPath, dryRun);
  }

  static findConfig(): string | null {
    const homeDir = os.homedir();
    const searchPaths = [
      path.join(process.cwd(), 'eamilos.yaml'),
      path.join(process.cwd(), '.eamilos.yaml'),
      path.join(homeDir, '.config', 'eamilos', 'config.yaml'),
      path.join(homeDir, '.eamilos.yaml'),
      path.join(process.cwd(), 'eamilos.config.yaml'),
      path.join(process.cwd(), '.eamilos.config.yaml'),
    ];

    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  }
}
