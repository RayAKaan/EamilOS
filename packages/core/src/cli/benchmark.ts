import chalk from 'chalk';
import { existsSync, writeFileSync } from 'fs';
import { BenchmarkRunner, BenchmarkSuiteResult } from '../model-router/index.js';
import { MetricsStore } from '../model-router/MetricsStore.js';
import { getSecureLogger } from '../security/SecureLogger.js';
import { getProviderManager } from '../provider-manager.js';
import { initOrchestrator } from '../orchestrator/StrictOrchestrator.js';
import { getConfig } from '../config.js';

export interface BenchmarkArgs {
  model?: string;
  verbose?: boolean;
  output?: string;
  projectId?: string;
}

async function detectAvailableModels(): Promise<Array<{ modelId: string; provider: string }>> {
  const models: Array<{ modelId: string; provider: string }> = [];

  try {
    const config = getConfig();
    for (const providerConfig of config.providers) {
      for (const modelConfig of providerConfig.models) {
        models.push({ modelId: modelConfig.id, provider: providerConfig.id });
      }
    }
  } catch {
    // Config not available
  }

  try {
    const providerManager = getProviderManager();
    const providerInfo = providerManager.getProviders();
    for (const provider of providerInfo) {
      if (provider.available) {
        models.push({ modelId: provider.model, provider: provider.id });
      }
    }
  } catch {
    // Provider manager not available
  }

  if (models.length === 0) {
    if (process.env.OLLAMA_HOST || existsSync('.ollama')) {
      models.push({ modelId: 'phi3:mini', provider: 'ollama' });
    }
    if (process.env.OPENAI_API_KEY) {
      models.push({ modelId: 'gpt-4o-mini', provider: 'openai' });
    }
    if (process.env.ANTHROPIC_API_KEY) {
      models.push({ modelId: 'claude-3-haiku', provider: 'anthropic' });
    }
  }

  if (models.length === 0) {
    models.push({ modelId: 'phi3:mini', provider: 'ollama' });
  }

  return models;
}

function padRight(str: string, len: number): string {
  return str.padEnd(len);
}

function calculateOverallScore(result: BenchmarkSuiteResult): number {
  return (
    result.overallSuccessRate * 0.5 +
    result.jsonComplianceRate * 0.2 +
    (1 - Math.min(result.averageRetries / 5, 1)) * 0.15 +
    (1 - Math.min(result.averageLatencyMs / 30000, 1)) * 0.15
  );
}

export async function benchmarkCommand(args: BenchmarkArgs = {}): Promise<void> {
  console.log(chalk.bold('\n EamilOS Model Benchmark'));
  console.log('═'.repeat(50));

  console.log(chalk.dim('\n Detecting available models...\n'));
  const availableModels = await detectAvailableModels();

  if (availableModels.length === 0) {
    console.log(chalk.red('❌ No models available.'));
    console.log(chalk.dim('   Install Ollama: https://ollama.ai'));
    console.log(chalk.dim('   Or set OPENAI_API_KEY environment variable.'));
    process.exit(1);
  }

  for (const m of availableModels) {
    console.log(chalk.green(`  ✓ ${m.modelId}`) + chalk.dim(` (${m.provider})`));
  }

  let modelsToTest = availableModels;
  if (args.model && args.model !== 'all') {
    modelsToTest = availableModels.filter(m => m.modelId === args.model);
    if (modelsToTest.length === 0) {
      console.log(chalk.red(`\n❌ Model '${args.model}' not found.`));
      console.log(chalk.dim('Available:'), availableModels.map(m => m.modelId).join(', '));
      process.exit(1);
    }
  }

  const store = new MetricsStore();
  const logger = getSecureLogger();
  const orchestrator = initOrchestrator({ maxRetries: 2 });
  const runner = new BenchmarkRunner(store, logger);
  const projectId = args.projectId || 'benchmark-' + Date.now();

  const taskCount = runner.getBenchmarkTasks().length;
  console.log(chalk.dim(`\n Running ${taskCount} tests per model...`));
  console.log(chalk.dim(` Models to test: ${modelsToTest.length}\n`));

  const results: BenchmarkSuiteResult[] = [];

  for (const model of modelsToTest) {
    if (args.verbose !== false) {
      console.log(chalk.cyan(`\n 🧪 Benchmarking:`) + ` ${model.modelId} ${chalk.dim(`(${model.provider})`)}`);
      console.log('─'.repeat(50));
    }

    try {
      const result = await runner.runSuite(
        model.modelId,
        model.provider,
        orchestrator,
        projectId,
        { verbose: args.verbose }
      );
      results.push(result);
    } catch (error) {
      console.log(chalk.red(`\n❌ Benchmark failed for ${model.modelId}:`));
      console.log(error instanceof Error ? error.message : String(error));
    }
  }

  if (results.length === 0) {
    console.log(chalk.red('\n❌ No benchmarks completed successfully.'));
    store.close();
    process.exit(1);
  }

  console.log('\n' + '═'.repeat(70));
  console.log(chalk.bold('📊 BENCHMARK RESULTS'));
  console.log('═'.repeat(70));

  console.log(
    padRight('Model', 25) +
    padRight('Success', 10) +
    padRight('Latency', 12) +
    padRight('JSON', 8) +
    padRight('Retries', 10) +
    padRight('Score', 8)
  );
  console.log('─'.repeat(70));

  for (const r of results) {
    const score = calculateOverallScore(r);
    console.log(
      chalk.white(padRight(r.modelId, 25)) +
      chalk.green(padRight(`${(r.overallSuccessRate * 100).toFixed(0)}%`, 10)) +
      chalk.blue(padRight(`${(r.averageLatencyMs / 1000).toFixed(1)}s`, 12)) +
      chalk.cyan(padRight(`${(r.jsonComplianceRate * 100).toFixed(0)}%`, 8)) +
      chalk.yellow(padRight(r.averageRetries.toFixed(1), 10)) +
      chalk.white(padRight(score.toFixed(2), 8))
    );
  }

  console.log('─'.repeat(70));

  if (results.length > 1) {
    const sorted = results.sort((a, b) =>
      calculateOverallScore(b) - calculateOverallScore(a)
    );
    console.log(chalk.green(`\n🏆 Best model: ${sorted[0].modelId}`) +
      chalk.dim(` (score: ${calculateOverallScore(sorted[0]).toFixed(2)})`));
  }

  if (args.output) {
    writeFileSync(args.output, JSON.stringify(results, null, 2));
    console.log(chalk.dim(`\n💾 Results saved to: ${args.output}`));
  }

  console.log(chalk.dim('\n✅ Benchmark complete. Model router will use these results for selection.\n'));

  store.close();
}
