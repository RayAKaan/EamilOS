import { FeedbackLoop } from '@eamilos/core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface InsightsOptions {
  model?: string;
  failures?: boolean;
  tuning?: boolean;
  prompts?: boolean;
  export?: string;
  json?: boolean;
}

function repeat(char: string, count: number): string {
  return char.repeat(Math.max(0, count));
}

function section(title: string): void {
  console.log('');
  console.log(title);
  console.log(repeat('-', title.length));
}

function kv(key: string, value: string | number): void {
  console.log(`  ${key}: ${value}`);
}

function formatLatency(ms: number): string {
  if (ms < 1000) return ms.toFixed(0) + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'm';
}

export async function insightsCommand(options: InsightsOptions = {}): Promise<void> {
  const storagePath = path.join(os.homedir(), '.eamilos', 'learning');

  const feedbackLoop = new FeedbackLoop({
    storagePath,
    enableAutoApply: false,
  });

  await feedbackLoop.initialize();

  if (options.export) {
    const data = feedbackLoop.exportData();
    fs.writeFileSync(options.export, data);
    console.log('Exported learning data to ' + options.export);
    return;
  }

  if (options.json) {
    const insights = feedbackLoop.getInsights();
    console.log(JSON.stringify(insights, null, 2));
    return;
  }

  if (options.failures) {
    await showFailurePatterns(feedbackLoop);
    return;
  }

  if (options.tuning) {
    await showTuningState(feedbackLoop);
    return;
  }

  if (options.prompts) {
    await showPromptEvolution(feedbackLoop);
    return;
  }

  if (options.model) {
    await showModelInsights(feedbackLoop, options.model);
    return;
  }

  await showSystemOverview(feedbackLoop);
}

async function showSystemOverview(feedbackLoop: FeedbackLoop): Promise<void> {
  const insights = feedbackLoop.getInsights();
  const overview = insights.systemOverview;

  console.log('\n=== EamilOS Learning Insights ===\n');

  section('System Overview');
  kv('Total executions', overview.totalExecutions);
  kv('Success rate', (overview.overallSuccessRate * 100).toFixed(1) + '%');
  kv('Avg latency', formatLatency(overview.avgLatencyMs));
  kv('Avg cost', '$' + overview.avgCostUSD.toFixed(4));
  kv('Learning active', overview.learningActive ? 'yes' : 'no');

  if (insights.modelRankings.length > 0) {
    section('Model Rankings');
    for (const model of insights.modelRankings.slice(0, 10)) {
      const score = (model.overallScore * 100).toFixed(0);
      const rate = (model.successRate * 100).toFixed(1);
      console.log(`  ${model.modelId}`);
      console.log(`    success: ${rate}%, latency: ${formatLatency(model.avgLatencyMs)}, cost: $${model.avgCostUSD.toFixed(4)}, score: ${score}%`);
    }
  }

  if (insights.strategyPerformance.length > 0) {
    section('Strategy Performance');
    for (const strategy of insights.strategyPerformance) {
      const trend = strategy.trend === 'improving' ? '↑' : strategy.trend === 'degrading' ? '↓' : '→';
      console.log(`  ${strategy.strategy}`);
      console.log(`    success: ${(strategy.successRate * 100).toFixed(1)}%, latency: ${formatLatency(strategy.avgLatencyMs)}, samples: ${strategy.sampleSize}, trend: ${trend}`);
    }
  }

  section('Failure Patterns');
  kv('Total patterns', insights.failurePatterns.totalPatterns);
  kv('Active', insights.failurePatterns.activePatterns);
  kv('Systematic', insights.failurePatterns.systematic);
  kv('Frequent', insights.failurePatterns.frequent);

  if (insights.failurePatterns.topModels.length > 0) {
    console.log('  Top failing models:');
    for (const m of insights.failurePatterns.topModels.slice(0, 3)) {
      console.log(`    - ${m.model} (${m.count} failures)`);
    }
  }

  const tuning = insights.autoTuning as Record<string, { current: number; direction: string; deviation: string }>;
  const tunedParams = Object.entries(tuning).filter(([, state]) => state.direction !== 'hold');

  section('Auto-Tuning');
  if (tunedParams.length > 0) {
    for (const [param, state] of tunedParams) {
      const dir = state.direction === 'increase' ? '↑' : '↓';
      console.log(`  ${param}: ${state.current} ${dir} (${state.deviation})`);
    }
  } else {
    console.log('  No parameters auto-tuned yet');
  }

  if (insights.recommendations.length > 0) {
    section('Recommendations');
    for (const rec of insights.recommendations) {
      console.log(`  - ${rec}`);
    }
  }

  console.log('');
}

async function showModelInsights(feedbackLoop: FeedbackLoop, modelId: string): Promise<void> {
  const explanation = feedbackLoop.explainRouting({ model: modelId });
  console.log('\n=== Model Insights ===\n');
  console.log(explanation);
  console.log('');
}

async function showFailurePatterns(feedbackLoop: FeedbackLoop): Promise<void> {
  const insights = feedbackLoop.getInsights();

  console.log('\n=== Failure Patterns ===\n');

  kv('Total detected', insights.failurePatterns.totalPatterns);
  kv('Active', insights.failurePatterns.activePatterns);
  kv('Systematic', insights.failurePatterns.systematic);
  kv('Frequent', insights.failurePatterns.frequent);

  if (insights.failurePatterns.topModels.length > 0) {
    console.log('\nTop failing models:');
    for (const m of insights.failurePatterns.topModels) {
      console.log(`  - ${m.model}: ${m.count} failures`);
    }
  }

  console.log('');
}

async function showTuningState(feedbackLoop: FeedbackLoop): Promise<void> {
  const insights = feedbackLoop.getInsights();
  const tuning = insights.autoTuning as Record<string, { current: number; default: number; min: number; max: number; direction: string; deviation: string }>;

  console.log('\n=== Auto-Tuning State ===\n');

  const entries = Object.entries(tuning);
  if (entries.length === 0) {
    console.log('  No parameters being tuned');
  } else {
    for (const [param, state] of entries) {
      const dir = state.direction === 'increase' ? '↑' : state.direction === 'decrease' ? '↓' : '→';
      console.log(`  ${param}`);
      console.log(`    current: ${state.current}, default: ${state.default}, range: [${state.min}, ${state.max}]`);
      console.log(`    direction: ${dir}, deviation: ${state.deviation}`);
    }
  }

  console.log('');
}

async function showPromptEvolution(feedbackLoop: FeedbackLoop): Promise<void> {
  const insights = feedbackLoop.getInsights();
  const prompt = insights.promptEvolution;

  console.log('\n=== Prompt Evolution ===\n');

  kv('Base prompts', prompt.totalBasePrompts);
  kv('Total variants', prompt.totalVariants);
  kv('Active variants', prompt.activeVariants);
  kv('Avg success rate', (prompt.averageSuccessRate * 100).toFixed(1) + '%');

  console.log('');
}
