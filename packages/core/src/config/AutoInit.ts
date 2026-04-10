import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigNormalizer, NormalizedConfig } from './ConfigNormalizer.js';
import { ConfigWriter } from './ConfigWriter.js';
import { OllamaDetector } from '../providers/OllamaDetector.js';
import { ProviderRegistry } from './ProviderRegistry.js';

export interface AutoInitResult {
  config: NormalizedConfig;
  providerRegistry: ProviderRegistry;
  configPath: string;
  created: boolean;
  provider: string;
  model: string;
  warnings: string[];
  errors: string[];
}

export interface DetectionResult {
  ollama: {
    installed: boolean;
    running: boolean;
    models: string[];
    recommendedModel?: string;
    endpoint: string;
  };
  openai: {
    apiKeyAvailable: boolean;
  };
  anthropic: {
    apiKeyAvailable: boolean;
  };
}

export class AutoInit {
  private configPaths: string[];
  private detector: OllamaDetector;
  private warnings: string[] = [];
  private errors: string[] = [];

  constructor() {
    this.detector = new OllamaDetector();
    this.configPaths = this.getDefaultConfigPaths();
  }

  private getDefaultConfigPaths(): string[] {
    const homeDir = os.homedir();
    return [
      path.join(process.cwd(), 'eamilos.yaml'),
      path.join(process.cwd(), '.eamilos.yaml'),
      path.join(homeDir, '.config', 'eamilos', 'config.yaml'),
      path.join(homeDir, '.eamilos.yaml'),
    ];
  }

  async detect(): Promise<DetectionResult> {
    const ollamaDetection = await this.detector.detect();

    return {
      ollama: {
        installed: ollamaDetection.installed,
        running: ollamaDetection.running,
        models: ollamaDetection.models.map((m) => m.name),
        recommendedModel: ollamaDetection.recommended || undefined,
        endpoint: 'http://localhost:11434',
      },
      openai: {
        apiKeyAvailable: !!process.env.OPENAI_API_KEY,
      },
      anthropic: {
        apiKeyAvailable: !!process.env.ANTHROPIC_API_KEY,
      },
    };
  }

  async autoInit(force: boolean = false): Promise<AutoInitResult> {
    this.warnings = [];
    this.errors = [];

    const existingConfig = this.findExistingConfig();

    if (existingConfig && !force) {
      return this.loadExistingConfig(existingConfig);
    }

    const detection = await this.detect();
    return this.createConfigFromDetection(detection);
  }

  private findExistingConfig(): string | null {
    for (const configPath of this.configPaths) {
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }
    return null;
  }

  private async loadExistingConfig(configPath: string): Promise<AutoInitResult> {
    const normalizer = new ConfigNormalizer();
    const raw = this.loadConfigFile(configPath);
    const config = normalizer.normalize(raw);

    const registryResult = await ProviderRegistry.fromConfig(config);

    this.warnings.push(...normalizer.getWarnings());
    this.warnings.push(...registryResult.errors);

    if (registryResult.errors.length > 0) {
      this.warnings.push(
        'Config has errors — some providers may not work. ' +
        'Run "eamilos doctor" for details.'
      );
    }

    this.getOrCreateRegistry().initialize(config);

    return {
      config,
      providerRegistry: this.getOrCreateRegistry(),
      configPath,
      created: false,
      provider: config.defaultProvider,
      model: config.defaultModel,
      warnings: this.warnings,
      errors: this.errors,
    };
  }

  private loadConfigFile(configPath: string): Record<string, unknown> {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const { parse } = require('yaml');
      return parse(content) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to load config from '${configPath}': ${message}`
      );
    }
  }

  private async createConfigFromDetection(
    detection: DetectionResult
  ): Promise<AutoInitResult> {
    let provider: string;
    let model: string;
    let configPath = this.configPaths[0];

    if (detection.ollama.running && detection.ollama.models.length > 0) {
      provider = 'ollama';
      model = detection.ollama.recommendedModel || detection.ollama.models[0];
      this.warnings.push(
        `Auto-detected Ollama with model '${model}'. ` +
        'No config found — creating one.'
      );
    } else if (detection.openai.apiKeyAvailable) {
      provider = 'openai';
      model = 'gpt-4o-mini';
      this.warnings.push(
        'Ollama not available — using OpenAI (API key detected). ' +
        'No config found — creating one.'
      );
    } else {
      provider = 'ollama';
      model = 'phi3:mini';
      this.warnings.push(
        'No LLM provider auto-detected. ' +
        `Creating config with '${provider}/${model}' as default. ` +
        'Run "eamilos setup" to customize.'
      );

      if (!detection.ollama.installed) {
        this.errors.push(
          'Ollama not installed. Install from: https://ollama.ai'
        );
      } else if (!detection.ollama.running) {
        this.errors.push(
          'Ollama is installed but not running. ' +
          'Start with: ollama serve'
        );
      }
    }

    const configData = ConfigWriter.generateDefault(provider, model);

    if (detection.ollama.running) {
      configData.models = detection.ollama.models.map((m) => ({
        id: m,
        provider: 'ollama',
      }));
    }

    ConfigWriter.write(configData, configPath);

    const normalizer = new ConfigNormalizer();
    const config = normalizer.normalize(configData);

    this.getOrCreateRegistry().initialize(config);

    return {
      config,
      providerRegistry: this.getOrCreateRegistry(),
      configPath,
      created: true,
      provider,
      model,
      warnings: this.warnings,
      errors: this.errors,
    };
  }

  private registry: ProviderRegistry | null = null;

  private getOrCreateRegistry(): ProviderRegistry {
    if (!this.registry) {
      this.registry = new ProviderRegistry();
    }
    return this.registry;
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  getErrors(): string[] {
    return [...this.errors];
  }

  static async run(force: boolean = false): Promise<AutoInitResult> {
    const autoInit = new AutoInit();
    return autoInit.autoInit(force);
  }

  static async detect(): Promise<DetectionResult> {
    const autoInit = new AutoInit();
    return autoInit.detect();
  }

  static getConfigPaths(): string[] {
    const instance = new AutoInit();
    return instance.configPaths;
  }

  static findConfig(): string | null {
    const instance = new AutoInit();
    return instance.findExistingConfig();
  }
}
