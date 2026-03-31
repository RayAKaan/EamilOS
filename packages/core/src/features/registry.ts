import { FeatureManager } from './FeatureManager.js';
import { ParallelExecutionFeature } from './ParallelExecutionFeature.js';
import { SelfHealingRoutingFeature } from './SelfHealingRoutingFeature.js';
import { AdaptivePromptingFeature } from './AdaptivePromptingFeature.js';
import { MetricsStore } from '../model-router/MetricsStore.js';

export function registerAllFeatures(
  manager: FeatureManager,
  dependencies: {
    metricsStore?: MetricsStore;
  } = {}
): void {
  manager.register(new ParallelExecutionFeature());

  const selfHealing = new SelfHealingRoutingFeature();
  manager.register(selfHealing);

  const adaptivePrompting = new AdaptivePromptingFeature();
  if (dependencies.metricsStore) {
    adaptivePrompting.setMetricsStore(dependencies.metricsStore);
  }
  manager.register(adaptivePrompting);
}

export { ParallelExecutionFeature } from './ParallelExecutionFeature.js';
export { SelfHealingRoutingFeature } from './SelfHealingRoutingFeature.js';
export { AdaptivePromptingFeature } from './AdaptivePromptingFeature.js';
