import { getConfig } from './config.js';
import { Logger, getLogger } from './logger.js';
import { ChatResponse } from './types.js';

export class ModelRouter {
  private logger: Logger;

  constructor() {
    this.logger = getLogger();
  }

  selectModel(taskType: string, preferredTier?: string): { provider: string; model: string } {
    const config = getConfig();

    const tier = config.routing.task_routing[taskType] ?? 
      preferredTier ?? 
      config.routing.default_tier;

    const provider = config.routing.fallback_order[0];
    const providerConfig = config.providers.find((p) => p.id === provider);
    
    if (!providerConfig) {
      throw new Error(`Provider not found: ${provider}`);
    }

    const model = providerConfig.models.find((m) => m.tier === tier);
    if (!model) {
      throw new Error(`Model not found for tier ${tier} in provider ${provider}`);
    }

    this.logger.debug(`Selected model: ${model.id} (tier: ${tier})`);

    return { provider, model: model.id };
  }

  async execute(
    _agentId: string,
    _context: string,
    taskType: string,
    _options?: { timeout?: number; correlationId?: string }
  ): Promise<ChatResponse> {
    const { model } = this.selectModel(taskType);

    this.logger.warn('Model router called but provider execution is PHASE 2');

    return {
      content: '',
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      latencyMs: 0,
      model,
      finishReason: 'stop',
    };
  }

  getContextWindow(modelId: string): number {
    const config = getConfig();
    for (const provider of config.providers) {
      const model = provider.models.find((m) => m.id === modelId);
      if (model) {
        return model.context_window;
      }
    }
    return 128000;
  }

  estimateCost(_inputTokens: number, _outputTokens: number, _modelId: string): number {
    return 0;
  }
}

let globalModelRouter: ModelRouter | null = null;

export function initModelRouter(): ModelRouter {
  globalModelRouter = new ModelRouter();
  return globalModelRouter;
}

export function getModelRouter(): ModelRouter {
  if (!globalModelRouter) {
    return initModelRouter();
  }
  return globalModelRouter;
}
