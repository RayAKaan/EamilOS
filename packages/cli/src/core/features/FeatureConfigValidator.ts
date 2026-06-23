import { SecureLogger } from '../security/SecureLogger.js';

export class FeatureConfigValidator {

  validate(
    rawConfig: Record<string, unknown>,
    logger: SecureLogger
  ): Record<string, Record<string, unknown>> {
    const features = (rawConfig.features || {}) as Record<string, Record<string, unknown>>;
    const validated: Record<string, Record<string, unknown>> = {};

    for (const [featureId, featureConfig] of Object.entries(features)) {
      if (typeof featureConfig !== 'object' || featureConfig === null) {
        logger.warn(`Invalid feature config for '${featureId}': must be an object`);
        continue;
      }

      const validatedFeature = { ...featureConfig };

      if (typeof validatedFeature.enabled !== 'boolean') {
        validatedFeature.enabled = false;
        logger.debug(`Feature '${featureId}': 'enabled' not set, defaulting to false`);
      }

      switch (featureId) {
        case 'parallel_execution':
          validatedFeature.max_models = this.clampInt(
            validatedFeature.max_models, 2, 10, 3, featureId, 'max_models', logger
          );
          validatedFeature.timeout_ms = this.clampInt(
            validatedFeature.timeout_ms, 5000, 120000, 30000, featureId, 'timeout_ms', logger
          );
          validatedFeature.min_model_score = this.clampFloat(
            validatedFeature.min_model_score, 0, 1, 0.3, featureId, 'min_model_score', logger
          );
          validatedFeature.selection_strategy = this.validateEnum(
            validatedFeature.selection_strategy,
            ['top_scored', 'random_sample', 'one_per_provider'],
            'top_scored', featureId, 'selection_strategy', logger
          );
          validatedFeature.result_selection = this.validateEnum(
            validatedFeature.result_selection,
            ['first_valid', 'highest_quality', 'fastest'],
            'first_valid', featureId, 'result_selection', logger
          );
          break;

        case 'self_healing_routing':
          validatedFeature.failure_threshold = this.clampInt(
            validatedFeature.failure_threshold, 1, 20, 3, featureId, 'failure_threshold', logger
          );
          validatedFeature.cooldown_minutes = this.clampInt(
            validatedFeature.cooldown_minutes, 1, 1440, 30, featureId, 'cooldown_minutes', logger
          );
          validatedFeature.max_blacklisted = this.clampFloat(
            validatedFeature.max_blacklisted, 0.1, 0.9, 0.5, featureId, 'max_blacklisted', logger
          );
          break;

        case 'adaptive_prompting':
          validatedFeature.strategy = this.validateEnum(
            validatedFeature.strategy,
            ['per_model', 'per_category', 'per_model_category'],
            'per_model', featureId, 'strategy', logger
          );
          validatedFeature.strict_threshold = this.clampFloat(
            validatedFeature.strict_threshold, 0, 1, 0.6, featureId, 'strict_threshold', logger
          );
          validatedFeature.nuclear_threshold = this.clampFloat(
            validatedFeature.nuclear_threshold, 0, 1, 0.3, featureId, 'nuclear_threshold', logger
          );
          break;

        default:
          logger.debug(`Unknown feature '${featureId}' — config passed through without validation`);
      }

      validated[featureId] = validatedFeature;
    }

    return validated;
  }

  private clampInt(
    value: unknown, min: number, max: number, defaultVal: number,
    featureId: string, field: string, logger: SecureLogger
  ): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      logger.debug(`${featureId}.${field}: using default ${defaultVal}`);
      return defaultVal;
    }
    if (value < min || value > max) {
      logger.warn(
        `${featureId}.${field}: ${value} out of range [${min}-${max}], clamping`);
      return Math.max(min, Math.min(max, value));
    }
    return value;
  }

  private clampFloat(
    value: unknown, min: number, max: number, defaultVal: number,
    featureId: string, field: string, logger: SecureLogger
  ): number {
    if (typeof value !== 'number') {
      logger.debug(`${featureId}.${field}: using default ${defaultVal}`);
      return defaultVal;
    }
    if (value < min || value > max) {
      logger.warn(
        `${featureId}.${field}: ${value} out of range [${min}-${max}], clamping`);
      return Math.max(min, Math.min(max, value));
    }
    return value;
  }

  private validateEnum(
    value: unknown, allowed: string[], defaultVal: string,
    featureId: string, field: string, logger: SecureLogger
  ): string {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      if (value !== undefined) {
        logger.warn(
          `${featureId}.${field}: '${value}' not valid. Allowed: ${allowed.join(', ')}. Using '${defaultVal}'`);
      }
      return defaultVal;
    }
    return value;
  }
}
