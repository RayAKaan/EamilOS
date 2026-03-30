import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { header, success, info } from '../ui.js';

export async function init(): Promise<void> {
  header('EamilOS Initialization');

  const configPath = resolve(process.cwd(), 'eamilos.config.yaml');
  const envPath = resolve(process.cwd(), '.env');
  const dataDir = resolve(process.cwd(), 'data');

  if (existsSync(configPath)) {
    info('Config file already exists, skipping');
  } else {
    const defaultConfig = `version: 1

providers:
  - id: openai
    type: openai
    api_key: \${OPENAI_API_KEY}
    models:
      - id: gpt-4o-mini
        tier: cheap
        context_window: 128000
      - id: gpt-4o
        tier: strong
        context_window: 128000

routing:
  default_tier: cheap
  task_routing:
    research: cheap
    coding: strong
    planning: strong
    qa: cheap
  fallback_order:
    - openai

workspace:
  base_dir: ./data/projects
  git_enabled: true
  max_file_size_mb: 10
  max_workspace_size_mb: 500

budget:
  max_tokens_per_task: 50000
  max_cost_per_project_usd: 5.00
  warn_at_percentage: 80

settings:
  max_parallel_tasks: 3
  task_timeout_seconds: 300
  model_call_timeout_seconds: 120
  preview_mode: true
  auto_retry: true

logging:
  level: info
  console: true
  file: ./data/logs/eamilos.log
  max_file_size_mb: 50
  max_files: 5
`;
    writeFileSync(configPath, defaultConfig, 'utf-8');
    success(`Created ${configPath}`);
  }

  if (existsSync(envPath)) {
    info('.env file already exists, skipping');
  } else {
    const envExample = '# Environment variables\nOPENAI_API_KEY=your-api-key-here\n';
    writeFileSync(envPath, envExample, 'utf-8');
    success('Created .env');
  }

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(resolve(dataDir, 'projects'), { recursive: true });
    mkdirSync(resolve(dataDir, 'logs'), { recursive: true });
    success(`Created data directory structure`);
  } else {
    info('Data directory already exists, skipping');
  }

  console.log('\nInitialization complete!');
  console.log('Edit .env to add your API keys, then run:');
  console.log('  eamilos run "Your project goal here"\n');
}
