import { execSync } from 'child_process';
import { OllamaDetector } from '../providers/OllamaDetector.js';

export interface ProviderStatus {
  id: string;
  type: 'ollama' | 'openai' | 'anthropic';
  installed: boolean;
  running: boolean;
  modelsAvailable: boolean;
  models: string[];
  error?: string;
  recommendedModel?: string;
  fixes?: string[];
}

export interface ReadinessResult {
  ready: boolean;
  providers: ProviderStatus[];
  primary: ProviderStatus | null;
  canExecute: boolean;
  errors: string[];
  fixes: string[];
}

export class ProviderReadiness {
  private ollamaDetector: OllamaDetector;

  constructor() {
    this.ollamaDetector = new OllamaDetector();
  }

  async validate(): Promise<ReadinessResult> {
    const result: ReadinessResult = {
      ready: false,
      providers: [],
      primary: null,
      canExecute: false,
      errors: [],
      fixes: [],
    };

    const ollamaStatus = await this.checkOllama();
    result.providers.push(ollamaStatus);

    const openaiStatus = this.checkOpenAI();
    result.providers.push(openaiStatus);

    const anthropicStatus = this.checkAnthropic();
    result.providers.push(anthropicStatus);

    for (const provider of result.providers) {
      if (provider.running && provider.modelsAvailable) {
        result.canExecute = true;
        result.primary = provider;
        result.ready = true;
        break;
      }
    }

    if (!result.ready) {
      for (const provider of result.providers) {
        if (provider.error) {
          result.errors.push(`${provider.type}: ${provider.error}`);
          if (provider.fixes) {
            result.fixes.push(...provider.fixes);
          }
        }
      }
    }

    return result;
  }

  private async checkOllama(): Promise<ProviderStatus> {
    const status: ProviderStatus = {
      id: 'ollama',
      type: 'ollama',
      installed: false,
      running: false,
      modelsAvailable: false,
      models: [],
    };

    try {
      const detection = await this.ollamaDetector.detect();
      status.installed = detection.installed;
      status.running = detection.running;
      status.models = detection.models.map((m: { name: string }) => m.name);

      if (!detection.installed) {
        status.error = 'Ollama is not installed';
        status.fixes = [
          'Install Ollama: curl -fsSL https://ollama.ai/install.sh | sh',
          'Windows: Download from https://ollama.ai/download'
        ];
        return status;
      }

      if (!detection.running) {
        status.error = 'Ollama is installed but not running';
        status.fixes = ['Start Ollama: ollama serve'];
        return status;
      }

      if (detection.models.length === 0) {
        status.error = 'Ollama running but no models installed';
        status.fixes = ['Install model: ollama pull phi3:mini'];
        return status;
      }

      status.modelsAvailable = true;
      status.recommendedModel = detection.recommended || detection.models[0]?.name;
    } catch (error) {
      status.error = error instanceof Error ? error.message : String(error);
      status.fixes = ['Check Ollama installation'];
    }

    return status;
  }

  private checkOpenAI(): ProviderStatus {
    const status: ProviderStatus = {
      id: 'openai',
      type: 'openai',
      installed: false,
      running: false,
      modelsAvailable: false,
      models: [],
    };

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      status.error = 'OPENAI_API_KEY not set';
      status.fixes = ['Set API key: export OPENAI_API_KEY=sk-...'];
      return status;
    }

    if (!apiKey.startsWith('sk-') || apiKey.length < 20) {
      status.error = 'OPENAI_API_KEY format appears invalid';
      status.fixes = ['Check your API key at https://platform.openai.com/api-keys'];
      return status;
    }

    status.installed = true;
    status.running = true;
    status.modelsAvailable = true;
    status.models = ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'];
    status.recommendedModel = 'gpt-4o-mini';

    return status;
  }

  private checkAnthropic(): ProviderStatus {
    const status: ProviderStatus = {
      id: 'anthropic',
      type: 'anthropic',
      installed: false,
      running: false,
      modelsAvailable: false,
      models: [],
    };

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      status.error = 'ANTHROPIC_API_KEY not set';
      status.fixes = ['Set API key: export ANTHROPIC_API_KEY=sk-ant-...'];
      return status;
    }

    if (!apiKey.startsWith('sk-ant-') || apiKey.length < 40) {
      status.error = 'ANTHROPIC_API_KEY format appears invalid';
      status.fixes = ['Check your API key at https://console.anthropic.com'];
      return status;
    }

    status.installed = true;
    status.running = true;
    status.modelsAvailable = true;
    status.models = ['claude-3-5-sonnet-latest', 'claude-3-haiku-20240307'];
    status.recommendedModel = 'claude-3-5-sonnet-latest';

    return status;
  }

  async attemptRecovery(status: ProviderStatus): Promise<boolean> {
    if (status.type === 'ollama' && status.installed && !status.running) {
      return this.attemptOllamaStart();
    }

    if (status.type === 'ollama' && status.running && !status.modelsAvailable) {
      return this.attemptModelPull();
    }

    return false;
  }

  private attemptOllamaStart(): boolean {
    try {
      execSync('ollama serve', { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private attemptModelPull(): boolean {
    try {
      execSync('ollama pull phi3:mini', { stdio: 'inherit', timeout: 300000 });
      return true;
    } catch {
      return false;
    }
  }

  getFallbackModels(): string[] {
    return ['phi3:mini', 'qwen2.5:3b', 'mistral:7b', 'llama3:8b'];
  }

  getDefaultModelForProvider(type: string): string {
    switch (type) {
      case 'ollama':
        return 'phi3:mini';
      case 'openai':
        return 'gpt-4o-mini';
      case 'anthropic':
        return 'claude-3-5-haiku';
      default:
        return 'phi3:mini';
    }
  }
}

let globalReadiness: ProviderReadiness | null = null;

export function getProviderReadiness(): ProviderReadiness {
  if (!globalReadiness) {
    globalReadiness = new ProviderReadiness();
  }
  return globalReadiness;
}
