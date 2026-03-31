import { Feature, FeatureContext, FeatureStatus } from './types.js';
import { getProviderManager } from '../provider-manager.js';
import { parseResponse, ParseResult } from '../parsers/ResponseParser.js';
import { ChatMessage } from '../types.js';
import { STRICT_SYSTEM_PROMPT } from '../prompts/system.js';

export class ParallelExecutionFeature implements Feature {
  readonly id = 'parallel_execution';
  readonly name = 'Parallel Execution';
  readonly description = 'Runs tasks against multiple models simultaneously and picks the best result';
  enabled = false;

  private config: {
    maxModels: number;
    selectionStrategy: 'top_scored' | 'random_sample' | 'one_per_provider';
    timeoutMs: number;
    resultSelection: 'first_valid' | 'highest_quality' | 'fastest';
    minModelScore: number;
  } = {
    maxModels: 3,
    selectionStrategy: 'top_scored',
    timeoutMs: 30000,
    resultSelection: 'first_valid',
    minModelScore: 0.3
  };

  private stats = {
    totalParallelRuns: 0,
    resultsImproved: 0,
    modelsUsedPerRun: [] as number[],
    averageTimeMs: 0,
  };
  private errors: string[] = [];

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config.maxModels = (config.max_models as number) || 3;
    this.config.selectionStrategy = (config.selection_strategy as any) || 'top_scored';
    this.config.timeoutMs = (config.timeout_ms as number) || 30000;
    this.config.resultSelection = (config.result_selection as any) || 'first_valid';
    this.config.minModelScore = (config.min_model_score as number) || 0.3;
  }

  getStatus(): FeatureStatus {
    return {
      id: this.id,
      enabled: this.enabled,
      initialized: true,
      health: this.errors.length > 5 ? 'degraded' : 'healthy',
      stats: {
        totalParallelRuns: this.stats.totalParallelRuns,
        resultsImproved: this.stats.resultsImproved,
        avgModelsPerRun: this.stats.modelsUsedPerRun.length > 0
          ? this.stats.modelsUsedPerRun.reduce((a, b) => a + b, 0) / this.stats.modelsUsedPerRun.length
          : 0,
        avgTimeMs: this.stats.averageTimeMs
      },
      lastActivity: new Date().toISOString(),
      errors: this.errors.slice(-10)
    };
  }

  async afterModelSelection(ctx: FeatureContext): Promise<void> {
    const modelsToRun = this.selectModels(ctx);

    if (modelsToRun.length <= 1) {
      return;
    }

    this.stats.totalParallelRuns++;
    this.stats.modelsUsedPerRun.push(modelsToRun.length);

    const startTime = Date.now();
    const results = await this.executeParallel(modelsToRun, ctx);
    const totalTime = Date.now() - startTime;

    this.stats.averageTimeMs = this.stats.totalParallelRuns === 1
      ? totalTime
      : (this.stats.averageTimeMs * (this.stats.totalParallelRuns - 1) + totalTime) / this.stats.totalParallelRuns;

    const best = this.selectBestResult(results);

    if (best) {
      ctx.featureData.set('parallel_execution:all_results', results);
      ctx.featureData.set('parallel_execution:models_used', modelsToRun.map(m => m.modelId));
      ctx.featureData.set('parallel_execution:winning_model', best.modelId);

      ctx.signals.skipExecution = true;
      ctx.signals.overrideResult = best.parseResult;

      ctx.selectedModel = {
        modelId: best.modelId,
        provider: best.provider,
        score: 0
      };

      if (best.modelId !== modelsToRun[0].modelId) {
        this.stats.resultsImproved++;
      }
    }
  }

  private selectModels(ctx: FeatureContext): Array<{ modelId: string; provider: string; score: number }> {
    const candidates = [ctx.selectedModel, ...ctx.alternateModels]
      .filter(m => m.score >= this.config.minModelScore && m.modelId);

    switch (this.config.selectionStrategy) {
      case 'top_scored':
        return candidates.slice(0, this.config.maxModels);

      case 'random_sample': {
        const shuffled = [...candidates].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, this.config.maxModels);
      }

      case 'one_per_provider': {
        const byProvider = new Map<string, typeof candidates[0]>();
        for (const m of candidates) {
          if (!byProvider.has(m.provider) && byProvider.size < this.config.maxModels) {
            byProvider.set(m.provider, m);
          }
        }
        return Array.from(byProvider.values());
      }

      default:
        return candidates.slice(0, this.config.maxModels);
    }
  }

  private async executeParallel(
    models: Array<{ modelId: string; provider: string }>,
    ctx: FeatureContext
  ): Promise<Array<{
    modelId: string;
    provider: string;
    parseResult: ParseResult;
    latencyMs: number;
    success: boolean;
  }>> {
    const promises = models.map(async (model) => {
      const startTime = Date.now();
      try {
        const messages: ChatMessage[] = [
          { role: 'system', content: ctx.systemPrompt || STRICT_SYSTEM_PROMPT },
          { role: 'user', content: ctx.userPrompt },
        ];

        const response = await Promise.race([
          getProviderManager().chat(messages, undefined, model.provider),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('PARALLEL_TIMEOUT')), this.config.timeoutMs)
          )
        ]);

        const parseResult = parseResponse(response.content || '');

        return {
          modelId: model.modelId,
          provider: model.provider,
          parseResult,
          latencyMs: Date.now() - startTime,
          success: parseResult.success && parseResult.files.length > 0
        };
      } catch (error) {
        this.errors.push(`${model.modelId}: ${error instanceof Error ? error.message : 'unknown'}`);
        if (this.errors.length > 50) this.errors = this.errors.slice(-10);

        return {
          modelId: model.modelId,
          provider: model.provider,
          parseResult: {
            success: false,
            summary: '',
            files: [],
            rawResponse: '',
            failureReason: error instanceof Error ? error.message : 'PARALLEL_ERROR'
          },
          latencyMs: Date.now() - startTime,
          success: false
        };
      }
    });

    const settled = await Promise.allSettled(promises);

    return settled
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  private selectBestResult(results: Array<{
    modelId: string;
    provider: string;
    parseResult: ParseResult;
    latencyMs: number;
    success: boolean;
  }>): typeof results[0] | null {
    const successfulResults = results.filter(r => r.success);

    if (successfulResults.length === 0) return null;

    switch (this.config.resultSelection) {
      case 'first_valid':
        return successfulResults[0];

      case 'fastest':
        return successfulResults.sort((a, b) => a.latencyMs - b.latencyMs)[0];

      case 'highest_quality':
        return successfulResults.sort((a, b) => {
          const aQuality = a.parseResult.files.reduce((sum, f) => sum + f.content.length, 0);
          const bQuality = b.parseResult.files.reduce((sum, f) => sum + f.content.length, 0);
          return bQuality - aQuality;
        })[0];

      default:
        return successfulResults[0];
    }
  }
}
