import * as os from 'os';

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  endpoint: string;
  version?: string;
  models: Array<{
    name: string;
    size: number;
    modified: string;
  }>;
  recommended: string | null;
  issues: string[];
  fixes: string[];
}

export class OllamaDetector {
  async detect(endpoint: string = 'http://localhost:11434'): Promise<OllamaStatus> {
    const status: OllamaStatus = {
      installed: false,
      running: false,
      endpoint,
      models: [],
      recommended: null,
      issues: [],
      fixes: [],
    };

    const isInstalled = await this.checkInstalled();
    status.installed = isInstalled;

    if (!isInstalled) {
      status.issues.push('Ollama is not installed');
      status.fixes.push('Install: curl -fsSL https://ollama.ai/install.sh | sh');
      status.fixes.push('Windows: Download from https://ollama.ai/download');
      return status;
    }

    status.version = await this.getVersion();

    const runningCheck = await this.checkRunning(endpoint);
    status.running = runningCheck;

    if (!runningCheck) {
      status.issues.push('Ollama is installed but not running');
      status.fixes.push('Start Ollama: ollama serve');
      return status;
    }

    const modelsData = await this.getModels(endpoint);
    status.models = modelsData;

    if (status.models.length === 0) {
      status.issues.push('No models installed');
      status.fixes.push('Install a model: ollama pull phi3:mini');
      status.fixes.push('For better quality: ollama pull qwen2.5-coder:7b');
      return status;
    }

    const modelNames = status.models.map((m) => m.name);
    status.recommended = this.selectBestModel(modelNames);

    if (status.recommended && status.recommended.toLowerCase().includes('phi3')) {
      status.issues.push(
        'phi3:mini works but has low JSON compliance (~40%). ' +
        'Expect more retries. For better results: ollama pull qwen2.5-coder:7b'
      );
    }

    return status;
  }

  private async checkInstalled(): Promise<boolean> {
    try {
      const { execSync } = await import('child_process');
      execSync('ollama --version', { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private async getVersion(): Promise<string | undefined> {
    try {
      const { execSync } = await import('child_process');
      const versionOutput = execSync('ollama --version', {
        timeout: 5000,
        encoding: 'utf-8',
      }).trim();
      return versionOutput;
    } catch {
      return undefined;
    }
  }

  private async checkRunning(endpoint: string): Promise<boolean> {
    try {
      const response = await fetch(`${endpoint}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async getModels(endpoint: string): Promise<Array<{ name: string; size: number; modified: string }>> {
    try {
      const response = await fetch(`${endpoint}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return [];

      const data = await response.json() as {
        models?: Array<{ name: string; size: number; modified_at: string }>;
      };

      return (data.models || []).map((m) => ({
        name: m.name,
        size: m.size,
        modified: m.modified_at,
      }));
    } catch {
      return [];
    }
  }

  private selectBestModel(modelNames: string[]): string | null {
    const ram = os.totalmem() / (1024 * 1024 * 1024);

    const preferenceByRAM = ram >= 16
      ? ['qwen2.5-coder', 'deepseek-coder', 'codellama', 'llama3.1', 'llama3', 'mistral', 'phi3']
      : ram >= 8
      ? ['mistral', 'llama3', 'deepseek-coder', 'phi3']
      : ['phi3'];

    for (const pref of preferenceByRAM) {
      const match = modelNames.find((m) => m.toLowerCase().includes(pref.toLowerCase()));
      if (match) return match;
    }

    return modelNames[0] || null;
  }

  async isUsable(endpoint: string = 'http://localhost:11434'): Promise<boolean> {
    try {
      const response = await fetch(`${endpoint}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return false;
      const data = await response.json() as { models?: unknown[] };
      return (data.models?.length || 0) > 0;
    } catch {
      return false;
    }
  }
}
