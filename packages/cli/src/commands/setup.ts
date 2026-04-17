import * as fs from 'fs';
import * as os from 'os';
import yaml from 'yaml';

interface ModelProfile {
  name: string;
  minRAM: number;
  description: string;
  contextWindow: number;
}

const OLLAMA_MODELS: ModelProfile[] = [
  { name: 'phi3:mini', minRAM: 2, description: 'Ultra-light, fast responses', contextWindow: 4096 },
  { name: 'llama3.2:1b', minRAM: 2, description: 'Lightweight, good general purpose', contextWindow: 8192 },
  { name: 'mistral:7b', minRAM: 6, description: 'Balanced performance', contextWindow: 8192 },
  { name: 'llama3.2:3b', minRAM: 4, description: 'Good balance of speed and quality', contextWindow: 8192 },
  { name: 'qwen2.5:7b', minRAM: 6, description: 'Strong coding abilities', contextWindow: 8192 },
  { name: 'llama3.1:8b', minRAM: 8, description: 'High quality responses', contextWindow: 32768 },
  { name: 'codellama:13b', minRAM: 12, description: 'Specialized for code', contextWindow: 16384 },
  { name: 'llama3.1:70b', minRAM: 64, description: 'Premium quality', contextWindow: 32768 },
];

const CLOUD_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-4o-mini', tier: 'cheap' as const, context_window: 128000 },
      { id: 'gpt-4o', tier: 'strong' as const, context_window: 128000 },
      { id: 'o1-mini', tier: 'cheap' as const, context_window: 65536 },
      { id: 'o1-preview', tier: 'strong' as const, context_window: 65536 },
    ],
    envKey: 'OPENAI_API_KEY',
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    models: [
      { id: 'claude-3-5-haiku', tier: 'cheap' as const, context_window: 200000 },
      { id: 'claude-3-5-sonnet', tier: 'strong' as const, context_window: 200000 },
      { id: 'claude-sonnet-4-20250514', tier: 'strong' as const, context_window: 200000 },
    ],
    envKey: 'ANTHROPIC_API_KEY',
  },
};

export interface SetupResult {
  provider: string;
  model: string;
  configPath: string;
}

async function getSystemRAM(): Promise<number> {
  return os.totalmem() / (1024 * 1024 * 1024);
}

async function detectOllama(): Promise<{ available: boolean; installedModels: string[] }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json() as { models?: Array<{ name: string }> };
      return {
        available: true,
        installedModels: data.models?.map(m => m.name) || []
      };
    }
  } catch {}
  return { available: false, installedModels: [] };
}

function detectCloudProviders(): string[] {
  const available: string[] = [];
  if (process.env.OPENAI_API_KEY) available.push('openai');
  if (process.env.ANTHROPIC_API_KEY) available.push('anthropic');
  return available;
}

function recommendModels(availableRAM: number, installedModels: string[]): string[] {
  const recommended: string[] = [];
  for (const model of OLLAMA_MODELS) {
    if (model.minRAM <= availableRAM && installedModels.includes(model.name)) {
      recommended.push(model.name);
      if (recommended.length >= 3) break;
    }
  }
  if (recommended.length === 0) {
    for (const model of OLLAMA_MODELS) {
      if (model.minRAM <= availableRAM) {
        recommended.push(`${model.name} (not installed)`);
        if (recommended.length >= 3) break;
      }
    }
  }
  return recommended;
}

function printHeader(): void {
  console.log('\n  EamilOS Setup Wizard\n');
  console.log('  ' + '─'.repeat(50));
}

function printSection(title: string): void {
  console.log(`\n  ${title}`);
  console.log('  ' + '-'.repeat(30));
}

async function setupCommand(options: {
  provider?: string;
  model?: string;
  force: boolean;
}): Promise<void> {
  const configPath = 'eamilos.config.yaml';
  if (fs.existsSync(configPath) && !options.force) {
    console.log(`\n  ⚠️  ${configPath} already exists.`);
    console.log('  Use --force to overwrite.\n');
    return;
  }

  printHeader();

  printSection('Step 1: Provider Detection');
  const [ram, ollamaStatus, cloudProviders] = await Promise.all([
    getSystemRAM(),
    detectOllama(),
    Promise.resolve(detectCloudProviders())
  ]);

  console.log(`\n  System RAM: ${ram.toFixed(1)} GB`);
  console.log(`  Ollama: ${ollamaStatus.available ? '✅ Running' : '❌ Not detected'}`);
  if (ollamaStatus.installedModels.length > 0) {
    console.log(`  Installed models: ${ollamaStatus.installedModels.join(', ')}`);
  }
  if (cloudProviders.length > 0) {
    console.log(`  Cloud providers: ${cloudProviders.map(p => {
      const provider = CLOUD_PROVIDERS[p as keyof typeof CLOUD_PROVIDERS];
      return provider ? provider.name : p;
    }).join(', ')}`);
  }

  let selectedProvider = options.provider;
  let selectedModel = options.model;

  if (!selectedProvider) {
    const providers: string[] = [];
    if (ollamaStatus.available) providers.push('ollama');
    providers.push(...cloudProviders);

    if (providers.length === 0) {
      console.log('\n  ❌ No AI providers detected!');
      console.log('  Please either:');
      console.log('    1. Install Ollama: https://ollama.ai  then run: ollama serve');
      console.log('    2. Set OPENAI_API_KEY or ANTHROPIC_API_KEY environment variable');
      console.log('  Then run: eamilos setup\n');
      return;
    }

    selectedProvider = providers[0];
    console.log(`\n  Auto-selected provider: ${selectedProvider}`);
  }

  if (!selectedModel) {
    if (selectedProvider === 'ollama') {
      printSection('Step 2: Model Recommendation');
      const recommendations = recommendModels(ram, ollamaStatus.installedModels);
      if (recommendations.length > 0) {
        console.log('\n  Based on your system RAM, recommended models:');
        recommendations.forEach((model, i) => {
          const installed = !model.includes('(not installed)');
          const icon = installed ? '✅' : '📦';
          console.log(`    ${i + 1}. ${icon} ${model.replace(' (not installed)', '')}`);
        });
      }
      selectedModel = ollamaStatus.installedModels[0] || 'phi3:mini';
      console.log(`\n  Auto-selected model: ${selectedModel}`);
    } else {
      const cloudProvider = CLOUD_PROVIDERS[selectedProvider as keyof typeof CLOUD_PROVIDERS];
      if (cloudProvider) {
        selectedModel = cloudProvider.models[0].id;
        console.log(`\n  Cloud provider model: ${selectedModel}`);
      }
    }
  }

  printSection('Step 3: Configuration');
  console.log(`\n  Creating ${configPath}...`);

  const finalModel = selectedModel || 'phi3:mini';
  const config = buildConfig(selectedProvider || 'ollama', finalModel, ollamaStatus.installedModels);
  const yamlContent = configToYaml(config);

  fs.writeFileSync(configPath, yamlContent, 'utf-8');
  console.log(`  ✅ Configuration saved to ${configPath}`);

  printSection('Next Steps');
  console.log('\n  1. Run: eamilos doctor  to verify your setup');
  if (selectedProvider === 'ollama' && selectedModel && !ollamaStatus.installedModels.includes(selectedModel)) {
    console.log(`  2. Install model: ollama pull ${selectedModel}`);
  }
  console.log('  3. Run: eamilos init  to initialize your workspace\n');
}

interface RoutingConfig {
  mode: string;
  default_tier: string;
  task_routing: Record<string, unknown>;
  fallback_order: string[];
  exploration_rate: number;
  minimum_data_points: number;
  overrides: Record<string, unknown>;
  default_model: string;
  default_provider: string;
}

function buildConfig(provider: string, model: string, installedModels: string[]): object {
  const routing: RoutingConfig = {
    mode: 'auto',
    default_tier: 'cheap',
    task_routing: {},
    fallback_order: [],
    exploration_rate: 0.1,
    minimum_data_points: 5,
    overrides: {},
    default_model: model,
    default_provider: provider,
  };

  const config: Record<string, unknown> = {
    version: 1,
    providers: [],
    routing,
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
      live: true,
    },
  };

  if (provider === 'ollama') {
    config.providers = [
      {
        id: 'ollama',
        type: 'ollama',
        models: installedModels.map(m => ({
          id: m,
          tier: m.includes('70b') ? 'strong' : 'cheap',
          context_window: 8192,
        })),
      },
    ];
    routing.fallback_order = ['ollama'];
  } else {
    const cloudConfig = CLOUD_PROVIDERS[provider as keyof typeof CLOUD_PROVIDERS];
    if (cloudConfig) {
      config.providers = [
        {
          id: provider,
          type: provider,
          api_key: provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY,
          models: cloudConfig.models,
        },
      ];
      routing.fallback_order = [provider];
    }
  }

  return config;
}

function configToYaml(config: object): string {
  return yaml.stringify(config);
}

export { setupCommand };
