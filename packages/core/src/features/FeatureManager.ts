import type { Feature, FeatureContext, FeatureHooks, FeatureStatus } from './types.js';
import { SecureLogger } from '../security/SecureLogger.js';

export class FeatureManager {
  private features: Feature[] = [];
  private logger: SecureLogger;
  private initialized: boolean = false;

  constructor(logger: SecureLogger) {
    this.logger = logger;
  }

  register(feature: Feature): void {
    if (this.initialized) {
      throw new Error(
        'Cannot register features after initialization. ' +
        'Register all features before calling initialize().'
      );
    }

    if (this.features.some(f => f.id === feature.id)) {
      throw new Error(`Feature '${feature.id}' is already registered.`);
    }

    this.features.push(feature);
    this.logger.debug(`Feature registered: ${feature.id}`, {
      metadata: { name: feature.name }
    });
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    const featuresConfig = (config.features || {}) as Record<string, Record<string, unknown>>;

    for (const feature of this.features) {
      const featureConfig = featuresConfig[feature.id] || {};
      const enabled = featureConfig.enabled === true;
      feature.enabled = enabled;

      if (!enabled) {
        this.logger.debug(`Feature disabled: ${feature.id}`);
        continue;
      }

      try {
        await feature.initialize(featureConfig);
        this.logger.info(`Feature initialized: ${feature.id}`, {
          metadata: {
            name: feature.name,
            config: this.sanitizeConfig(featureConfig)
          }
        });
      } catch (error) {
        feature.enabled = false;
        this.logger.warn(`Feature failed to initialize: ${feature.id}`, {
          metadata: {
            error: error instanceof Error ? error.message : String(error),
            action: 'Feature has been disabled. System continues without it.'
          }
        });
      }
    }

    this.initialized = true;

    const enabledCount = this.features.filter(f => f.enabled).length;
    this.logger.info('Feature system initialized', {
      metadata: {
        total: this.features.length,
        enabled: enabledCount,
        disabled: this.features.length - enabledCount,
        features: this.features.map(f => ({
          id: f.id,
          enabled: f.enabled
        }))
      }
    });
  }

  async runHook(
    hookName: keyof FeatureHooks,
    ctx: FeatureContext,
    error?: Error
  ): Promise<void> {
    if (!this.initialized) return;

    for (const feature of this.features) {
      if (!feature.enabled) continue;

      const hookFn = feature[hookName] as Function | undefined;
      if (!hookFn) continue;

      if (ctx.signals.abortExecution) {
        this.logger.debug(`Hook ${hookName} aborted before ${feature.id}`, {
          metadata: { reason: ctx.signals.abortReason }
        });
        break;
      }

      try {
        const startTime = Date.now();

        if (hookName === 'onError' && error) {
          await (feature as any).onError(ctx, error);
        } else {
          await hookFn.call(feature, ctx);
        }

        const duration = Date.now() - startTime;

        this.logger.debug(`Hook ${hookName} completed: ${feature.id}`, {
          metadata: { durationMs: duration }
        });

        if (duration > 1000) {
          this.logger.warn(`Slow feature hook: ${feature.id}.${hookName}`, {
            metadata: { durationMs: duration, threshold: 1000 }
          });
        }
      } catch (hookError) {
        this.logger.warn(`Feature hook error: ${feature.id}.${hookName}`, {
          metadata: {
            error: hookError instanceof Error ? hookError.message : String(hookError),
            action: 'Continuing pipeline. Feature error does not affect execution.'
          }
        });
      }
    }
  }

  createContext(
    instruction: string,
    config: Record<string, unknown>
  ): FeatureContext {
    return {
      instruction,
      taskCategory: 'simple',
      taskComplexity: 'moderate',
      estimatedTokens: 0,

      selectedModel: { modelId: '', provider: '', score: 0 },
      alternateModels: [],
      availableModels: [],

      systemPrompt: '',
      userPrompt: '',
      promptMode: 'initial',

      currentAttempt: 0,
      maxRetries: 4,
      totalTokensUsed: 0,
      totalLatencyMs: 0,

      featureData: new Map(),

      signals: {
        skipExecution: false,
        overrideResult: null,
        forceRetry: false,
        abortExecution: false,
      },

      executionId: crypto.randomUUID(),
      startTime: Date.now(),
      config
    };
  }

  getAllStatus(): FeatureStatus[] {
    return this.features.map(f => f.getStatus());
  }

  getFeature(id: string): Feature | undefined {
    return this.features.find(f => f.id === id);
  }

  getEnabledFeatures(): Feature[] {
    return this.features.filter(f => f.enabled);
  }

  async destroy(): Promise<void> {
    for (const feature of this.features) {
      if (feature.enabled && feature.destroy) {
        try {
          await feature.destroy();
        } catch (error) {
          this.logger.warn(`Feature cleanup error: ${feature.id}`, {
            metadata: {
              error: error instanceof Error ? error.message : String(error)
            }
          });
        }
      }
    }
  }

  private sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (/key|secret|token|password|credential/i.test(key)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}
