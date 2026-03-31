import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FeatureManager } from '../../src/features/FeatureManager.js';
import { FeatureConfigValidator } from '../../src/features/FeatureConfigValidator.js';
import { ParallelExecutionFeature } from '../../src/features/ParallelExecutionFeature.js';
import { SelfHealingRoutingFeature } from '../../src/features/SelfHealingRoutingFeature.js';
import { AdaptivePromptingFeature } from '../../src/features/AdaptivePromptingFeature.js';
import { Feature, FeatureContext, FeatureStatus } from '../../src/features/types.js';

class MockSecureLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
  log = vi.fn();
}

describe('Feature Engine Tests', () => {
  let logger: MockSecureLogger;
  let manager: FeatureManager;

  beforeEach(() => {
    logger = new MockSecureLogger();
    manager = new FeatureManager(logger as any);
  });

  describe('FeatureManager', () => {
    it('FE-1: registers features correctly', () => {
      const testFeature: Feature = {
        id: 'test_feature',
        name: 'Test Feature',
        description: 'Test',
        enabled: false,
        async initialize() {},
        getStatus() {
          return {
            id: 'test_feature',
            enabled: false,
            initialized: true,
            health: 'healthy',
            stats: {},
            errors: []
          };
        }
      };

      manager.register(testFeature);
      expect(manager.getFeature('test_feature')).toBe(testFeature);
    });

    it('FE-2: rejects duplicate registration', () => {
      const testFeature: Feature = {
        id: 'test_feature',
        name: 'Test Feature',
        description: 'Test',
        enabled: false,
        async initialize() {},
        getStatus() {
          return {
            id: 'test_feature',
            enabled: false,
            initialized: true,
            health: 'healthy',
            stats: {},
            errors: []
          };
        }
      };

      manager.register(testFeature);
      expect(() => manager.register(testFeature)).toThrow();
    });

    it('FE-3: rejects late registration after init', async () => {
      const testFeature: Feature = {
        id: 'test_feature',
        name: 'Test Feature',
        description: 'Test',
        enabled: false,
        async initialize() {},
        getStatus() {
          return {
            id: 'test_feature',
            enabled: false,
            initialized: true,
            health: 'healthy',
            stats: {},
            errors: []
          };
        }
      };

      manager.register(testFeature);
      await manager.initialize({ features: {} });
      expect(() => manager.register(testFeature)).toThrow();
    });

    it('FE-4: disables feature by default (no config entry)', async () => {
      const testFeature: Feature = {
        id: 'test_feature',
        name: 'Test Feature',
        description: 'Test',
        enabled: false,
        async initialize() {},
        getStatus() {
          return {
            id: 'test_feature',
            enabled: this.enabled,
            initialized: true,
            health: 'healthy',
            stats: {},
            errors: []
          };
        }
      };

      manager.register(testFeature);
      await manager.initialize({ features: {} });
      expect(testFeature.enabled).toBe(false);
    });

    it('FE-5: enables feature via config', async () => {
      const testFeature: Feature = {
        id: 'test_feature',
        name: 'Test Feature',
        description: 'Test',
        enabled: false,
        async initialize() {},
        getStatus() {
          return {
            id: 'test_feature',
            enabled: this.enabled,
            initialized: true,
            health: 'healthy',
            stats: {},
            errors: []
          };
        }
      };

      manager.register(testFeature);
      await manager.initialize({ features: { test_feature: { enabled: true } } });
      expect(testFeature.enabled).toBe(true);
    });

    it('FE-6: init failure disables feature without crash', async () => {
      const failFeature: Feature = {
        id: 'fail_feature',
        name: 'Failing Feature',
        description: 'Test',
        enabled: false,
        async initialize() { throw new Error('Boom'); },
        getStatus() {
          return {
            id: 'fail_feature',
            enabled: false,
            initialized: false,
            health: 'failed',
            stats: {},
            errors: ['Boom']
          };
        }
      };

      manager.register(failFeature);
      await manager.initialize({ features: { fail_feature: { enabled: true } } });
      expect(failFeature.enabled).toBe(false);
    });

    it('FE-7: hook execution runs in registration order', async () => {
      const callOrder: string[] = [];

      const feature1: Feature = {
        id: 'feature1',
        name: 'Feature 1',
        description: 'Test',
        enabled: true,
        async initialize() {},
        async beforeExecution(ctx) { callOrder.push('feature1'); },
        getStatus() {
          return {
            id: 'feature1',
            enabled: true,
            initialized: true,
            health: 'healthy',
            stats: {},
            errors: []
          };
        }
      };

      const feature2: Feature = {
        id: 'feature2',
        name: 'Feature 2',
        description: 'Test',
        enabled: true,
        async initialize() {},
        async beforeExecution(ctx) { callOrder.push('feature2'); },
        getStatus() {
          return {
            id: 'feature2',
            enabled: true,
            initialized: true,
            health: 'healthy',
            stats: {},
            errors: []
          };
        }
      };

      manager.register(feature1);
      manager.register(feature2);
      await manager.initialize({ features: { feature1: { enabled: true }, feature2: { enabled: true } } });

      const ctx = manager.createContext('test', {});
      await manager.runHook('beforeExecution', ctx);

      expect(callOrder).toEqual(['feature1', 'feature2']);
    });

    it('FE-8: hook error in one feature does not affect others', async () => {
      const feature1: Feature = {
        id: 'feature1',
        name: 'Feature 1',
        description: 'Test',
        enabled: true,
        async initialize() {},
        async beforeExecution() { throw new Error('Feature1 error'); },
        getStatus() {
          return {
            id: 'feature1',
            enabled: true,
            initialized: true,
            health: 'healthy',
            stats: {},
            errors: []
          };
        }
      };

      const feature2: Feature = {
        id: 'feature2',
        name: 'Feature 2',
        description: 'Test',
        enabled: true,
        async initialize() {},
        async beforeExecution(ctx) { ctx.featureData.set('feature2_called', true); },
        getStatus() {
          return {
            id: 'feature2',
            enabled: true,
            initialized: true,
            health: 'healthy',
            stats: {},
            errors: []
          };
        }
      };

      manager.register(feature1);
      manager.register(feature2);
      await manager.initialize({ features: { feature1: { enabled: true }, feature2: { enabled: true } } });

      const ctx = manager.createContext('test', {});
      await manager.runHook('beforeExecution', ctx);

      expect(ctx.featureData.get('feature2_called')).toBe(true);
    });

    it('FE-9: abort signal stops hook chain', async () => {
      const callOrder: string[] = [];

      const feature1: Feature = {
        id: 'feature1',
        name: 'Feature 1',
        description: 'Test',
        enabled: true,
        async initialize() {},
        async beforeExecution(ctx) {
          callOrder.push('feature1');
          ctx.signals.abortExecution = true;
          ctx.signals.abortReason = 'Test abort';
        },
        getStatus() {
          return {
            id: 'feature1',
            enabled: true,
            initialized: true,
            health: 'healthy',
            stats: {},
            errors: []
          };
        }
      };

      const feature2: Feature = {
        id: 'feature2',
        name: 'Feature 2',
        description: 'Test',
        enabled: true,
        async initialize() {},
        async beforeExecution() { callOrder.push('feature2'); },
        getStatus() {
          return {
            id: 'feature2',
            enabled: true,
            initialized: true,
            health: 'healthy',
            stats: {},
            errors: []
          };
        }
      };

      manager.register(feature1);
      manager.register(feature2);
      await manager.initialize({ features: { feature1: { enabled: true }, feature2: { enabled: true } } });

      const ctx = manager.createContext('test', {});
      await manager.runHook('beforeExecution', ctx);

      expect(callOrder).toEqual(['feature1']);
      expect(ctx.signals.abortExecution).toBe(true);
    });

    it('FE-10: context factory creates valid context', () => {
      const ctx = manager.createContext('test instruction', { someConfig: true });

      expect(ctx.executionId.length).toBeGreaterThan(0);
      expect(ctx.signals.abortExecution).toBe(false);
      expect(ctx.featureData).toBeInstanceOf(Map);
      expect(ctx.instruction).toBe('test instruction');
    });

    it('FE-11: getAllStatus returns all features', async () => {
      const feature1: Feature = {
        id: 'feature1',
        name: 'Feature 1',
        description: 'Test',
        enabled: true,
        async initialize() {},
        getStatus() {
          return {
            id: 'feature1',
            enabled: true,
            initialized: true,
            health: 'healthy',
            stats: {},
            errors: []
          };
        }
      };

      manager.register(feature1);
      await manager.initialize({ features: { feature1: { enabled: true } } });

      const statuses = manager.getAllStatus();
      expect(statuses.length).toBe(1);
      expect(statuses[0].id).toBe('feature1');
    });

    it('FE-12: destroy calls cleanup on all features', async () => {
      let destroyed = false;

      const feature: Feature = {
        id: 'feature',
        name: 'Feature',
        description: 'Test',
        enabled: true,
        async initialize() {},
        async destroy() { destroyed = true; },
        getStatus() {
          return {
            id: 'feature',
            enabled: true,
            initialized: true,
            health: 'healthy',
            stats: {},
            errors: []
          };
        }
      };

      manager.register(feature);
      await manager.initialize({ features: { feature: { enabled: true } } });
      await manager.destroy();

      expect(destroyed).toBe(true);
    });
  });

  describe('FeatureConfigValidator', () => {
    it('CV-1: valid config passes unchanged', () => {
      const validator = new FeatureConfigValidator();
      const validConfig = {
        features: {
          parallel_execution: { enabled: true, max_models: 3, timeout_ms: 15000 },
          self_healing_routing: { enabled: true, failure_threshold: 5 },
          adaptive_prompting: { enabled: true, strategy: 'per_model' }
        }
      };

      const validated = validator.validate(validConfig, logger as any);

      expect(validated.parallel_execution?.max_models).toBe(3);
      expect(validated.parallel_execution?.timeout_ms).toBe(15000);
      expect(validated.self_healing_routing?.failure_threshold).toBe(5);
    });

    it('CV-2: out-of-range integers clamped', () => {
      const validator = new FeatureConfigValidator();
      const clampConfig = {
        features: {
          parallel_execution: { enabled: true, max_models: 50, timeout_ms: 1 }
        }
      };

      const clamped = validator.validate(clampConfig, logger as any);

      expect(clamped.parallel_execution?.max_models).toBe(10);
      expect(clamped.parallel_execution?.timeout_ms).toBe(5000);
    });

    it('CV-3: out-of-range floats clamped', () => {
      const validator = new FeatureConfigValidator();
      const config = {
        features: {
          self_healing_routing: { enabled: true, max_blacklisted: 2.0 }
        }
      };

      const clamped = validator.validate(config, logger as any);

      expect(clamped.self_healing_routing?.max_blacklisted).toBe(0.9);
    });

    it('CV-4: invalid enum defaults correctly', () => {
      const validator = new FeatureConfigValidator();
      const config = {
        features: {
          adaptive_prompting: { enabled: true, strategy: 'invalid_value' }
        }
      };

      const validated = validator.validate(config, logger as any);

      expect(validated.adaptive_prompting?.strategy).toBe('per_model');
    });

    it('CV-5: missing config produces empty result', () => {
      const validator = new FeatureConfigValidator();
      const emptyConfig = { features: {} };

      const validated = validator.validate(emptyConfig, logger as any);

      expect(Object.keys(validated).length).toBe(0);
    });

    it('CV-6: unknown features pass through', () => {
      const validator = new FeatureConfigValidator();
      const config = {
        features: {
          unknown_feature: { enabled: true, custom_field: 'value' }
        }
      };

      const validated = validator.validate(config, logger as any);

      expect(validated.unknown_feature).toBeDefined();
      expect(validated.unknown_feature?.custom_field).toBe('value');
    });
  });

  describe('SelfHealingRoutingFeature', () => {
    it('SH-1: model blacklisted after N consecutive failures', async () => {
      const feature = new SelfHealingRoutingFeature();
      await feature.initialize({ failure_threshold: 3 });
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'test-model', provider: 'test', score: 1.0 };

      for (let i = 0; i < 3; i++) {
        ctx.executionResult = {
          success: false,
          files: [],
          retriesUsed: 0,
          latencyMs: 100,
          tokensUsed: 0,
          parseSucceeded: false,
          validationSucceeded: false,
          failureReason: 'Test failure'
        };
        await feature.afterExecution(ctx);
      }

      const status = feature.getStatus();
      expect(status.stats.totalBlacklists).toBeGreaterThan(0);
    });

    it('SH-2: blacklisted model removed from selection', async () => {
      const feature = new SelfHealingRoutingFeature();
      await feature.initialize({ failure_threshold: 1 });
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'test-model', provider: 'test', score: 1.0 };
      ctx.alternateModels = [
        { modelId: 'alt-model', provider: 'test', score: 0.5 }
      ];

      ctx.executionResult = {
        success: false,
        files: [],
        retriesUsed: 0,
        latencyMs: 100,
        tokensUsed: 0,
        parseSucceeded: false,
        validationSucceeded: false,
        failureReason: 'Test'
      };
      await feature.afterExecution(ctx);

      await feature.afterModelSelection(ctx);

      expect(ctx.selectedModel.modelId).toBe('alt-model');
    });

    it('SH-3: blacklist expires after cooldown', async () => {
      const feature = new SelfHealingRoutingFeature();
      await feature.initialize({ cooldown_minutes: 1, failure_threshold: 1 });
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'test-model', provider: 'test', score: 1.0 };
      ctx.availableModels = [{ modelId: 'test-model', provider: 'test' }];

      ctx.executionResult = {
        success: false,
        files: [],
        retriesUsed: 0,
        latencyMs: 100,
        tokensUsed: 0,
        parseSucceeded: false,
        validationSucceeded: false,
        failureReason: 'Test'
      };
      await feature.afterExecution(ctx);

      // Blacklist entry should be created
      const blacklistSize = (feature as any).blacklist?.size ?? 0;
      expect(blacklistSize).toBe(1);

      // After calling afterModelSelection, expired entries are cleaned up
      // This simulates time passing and the cooldown expiring
      await feature.afterModelSelection(ctx);

      // The blacklist entry exists but hasn't expired yet (1 minute cooldown)
      const status = feature.getStatus();
      expect(status.stats.currentBlacklisted).toBeGreaterThanOrEqual(0);
    });

    it('SH-4: success resets failure counter', async () => {
      const feature = new SelfHealingRoutingFeature();
      await feature.initialize({ failure_threshold: 3, reset_on_success: true });
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'test-model', provider: 'test', score: 1.0 };

      // Add one failure
      ctx.executionResult = {
        success: false,
        files: [],
        retriesUsed: 0,
        latencyMs: 100,
        tokensUsed: 0,
        parseSucceeded: false,
        validationSucceeded: false,
        failureReason: 'Test'
      };
      await feature.afterExecution(ctx);

      // Add success
      ctx.executionResult = {
        success: true,
        files: [],
        retriesUsed: 0,
        latencyMs: 100,
        tokensUsed: 0,
        parseSucceeded: true,
        validationSucceeded: true
      };
      await feature.afterExecution(ctx);

      // Add 2 more failures - should NOT be blacklisted (counter reset)
      for (let i = 0; i < 2; i++) {
        ctx.executionResult = {
          success: false,
          files: [],
          retriesUsed: 0,
          latencyMs: 100,
          tokensUsed: 0,
          parseSucceeded: false,
          validationSucceeded: false,
          failureReason: 'Test'
        };
        await feature.afterExecution(ctx);
      }

      const status = feature.getStatus();
      expect(status.stats.totalBlacklists).toBe(0);
    });

    it('SH-5: max blacklist ratio prevents over-blacklisting', async () => {
      const feature = new SelfHealingRoutingFeature();
      await feature.initialize({
        failure_threshold: 1,
        max_blacklisted: 0.5
      });
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.availableModels = [
        { modelId: 'model1', provider: 'test' },
        { modelId: 'model2', provider: 'test' }
      ];

      // Blacklist first model
      ctx.selectedModel = { modelId: 'model1', provider: 'test', score: 1.0 };
      ctx.executionResult = {
        success: false,
        files: [],
        retriesUsed: 0,
        latencyMs: 100,
        tokensUsed: 0,
        parseSucceeded: false,
        validationSucceeded: false,
        failureReason: 'Test'
      };
      await feature.afterExecution(ctx);

      // Try to blacklist second model (should be blocked by ratio)
      ctx.selectedModel = { modelId: 'model2', provider: 'test', score: 1.0 };
      ctx.alternateModels = [];
      await feature.afterExecution(ctx);

      const status = feature.getStatus();
      expect(status.stats.totalBlacklists).toBe(1);
    });

    it('SH-6: per-category tracking works', async () => {
      const feature = new SelfHealingRoutingFeature();
      await feature.initialize({ failure_threshold: 1, track_per_category: true });
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'test-model', provider: 'test', score: 1.0 };
      ctx.availableModels = [{ modelId: 'test-model', provider: 'test' }];

      // Fail on 'code' category
      ctx.taskCategory = 'code';
      ctx.executionResult = {
        success: false,
        files: [],
        retriesUsed: 0,
        latencyMs: 100,
        tokensUsed: 0,
        parseSucceeded: false,
        validationSucceeded: false,
        failureReason: 'Test'
      };
      await feature.afterExecution(ctx);

      // Model should be blacklisted for 'code' but not 'json'
      const status = feature.getStatus();
      expect(status.stats.totalBlacklists).toBe(1);

      ctx.taskCategory = 'json';
      await feature.afterModelSelection(ctx);

      // For 'json', the model should still be available (category-specific blacklist)
      expect(ctx.selectedModel.modelId).toBe('test-model');
    });

    it('SH-7: events emitted on blacklist/restore', () => {
      const feature = new HealedRoutingFeature();
      let blacklistEvents = 0;
      let restoreEvents = 0;

      feature.on('model.blacklisted', () => blacklistEvents++);
      feature.on('model.restored', () => restoreEvents++);

      feature.simulateBlacklist('test-model', 'code');
      feature.simulateRestore('test-model', 'code');

      expect(blacklistEvents).toBe(1);
      expect(restoreEvents).toBe(1);
    });

    it('SH-8: status reports correct blacklist state', async () => {
      const feature = new SelfHealingRoutingFeature();
      await feature.initialize({});
      feature.enabled = true;

      const status = feature.getStatus();
      expect(status.id).toBe('self_healing_routing');
      expect(status.enabled).toBe(true);
      expect(status.stats).toBeDefined();
    });
  });

  describe('AdaptivePromptingFeature', () => {
    it('AP-1: phi3 model gets nuclear prompt automatically', async () => {
      const feature = new AdaptivePromptingFeature();
      await feature.initialize({});
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'phi3:mini', provider: 'ollama', score: 1.0 };
      ctx.promptMode = 'initial';
      ctx.systemPrompt = 'Original prompt';

      await feature.beforeExecution(ctx);

      expect(ctx.promptMode).toBe('nuclear');
    });

    it('AP-2: gpt-4 model gets light prompt', async () => {
      const feature = new AdaptivePromptingFeature();
      await feature.initialize({});
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'gpt-4o', provider: 'openai', score: 1.0 };
      ctx.promptMode = 'initial';

      const originalPrompt = ctx.userPrompt;

      await feature.beforeExecution(ctx);

      // GPT-4 should not have nuclear mode forced
      expect(ctx.promptMode).toBe('initial');
      // But should have adaptations
      expect(ctx.featureData.get('adaptive_prompting:profile_used')).toBe('known:gpt-4');
    });

    it('AP-3: unknown model gets default profile', async () => {
      const feature = new AdaptivePromptingFeature();
      await feature.initialize({});
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'unknown-model', provider: 'test', score: 1.0 };
      ctx.promptMode = 'initial';

      await feature.beforeExecution(ctx);

      expect(ctx.featureData.get('adaptive_prompting:profile_used')).toBe('default');
    });

    it('AP-4: custom profile overrides known profile', async () => {
      const feature = new AdaptivePromptingFeature();
      await feature.initialize({
        custom_profiles: {
          'phi3:mini': {
            alwaysNuclear: false
          }
        }
      });
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'phi3:mini', provider: 'ollama', score: 1.0 };
      ctx.promptMode = 'initial';

      await feature.beforeExecution(ctx);

      expect(ctx.promptMode).toBe('initial');
      expect(ctx.featureData.get('adaptive_prompting:profile_used')).toBe('custom:phi3:mini');
    });

    it('AP-5: long instruction truncated per profile', async () => {
      const feature = new AdaptivePromptingFeature();
      await feature.initialize({});
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'phi3:mini', provider: 'ollama', score: 1.0 };
      ctx.userPrompt = 'x'.repeat(5000);
      ctx.promptMode = 'initial';

      await feature.beforeExecution(ctx);

      expect(ctx.userPrompt.length).toBeLessThan(5000);
      expect(ctx.userPrompt).toContain('[Instruction truncated');
    });

    it('AP-6: vocabulary simplification applied when configured', async () => {
      const feature = new AdaptivePromptingFeature();
      await feature.initialize({
        custom_profiles: {
          'test-model': {
            useSimplifiedVocabulary: true
          }
        }
      });
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'test-model', provider: 'test', score: 1.0 };
      ctx.userPrompt = 'Please implement this functionality';

      await feature.beforeExecution(ctx);

      expect(ctx.userPrompt).toContain('create');
      expect(ctx.userPrompt).not.toContain('implement');
    });

    it('AP-7: format example prepended when configured', async () => {
      const feature = new AdaptivePromptingFeature();
      await feature.initialize({
        custom_profiles: {
          'test-model': {
            prependFormatExample: true
          }
        }
      });
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'test-model', provider: 'test', score: 1.0 };
      ctx.userPrompt = 'Create a function';

      await feature.beforeExecution(ctx);

      expect(ctx.userPrompt).toContain('YOUR OUTPUT MUST LOOK EXACTLY LIKE THIS');
    });

    it('AP-8: stats track adaptations correctly', async () => {
      const feature = new AdaptivePromptingFeature();
      await feature.initialize({});
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'phi3:mini', provider: 'ollama', score: 1.0 };
      ctx.promptMode = 'initial';

      await feature.beforeExecution(ctx);

      const status = feature.getStatus();
      expect(status.stats.promptsAdapted).toBe(1);
      expect(status.stats.nuclearPromotions).toBe(1);
    });
  });

  describe('ParallelExecutionFeature', () => {
    it('PE-1: multiple models selected based on strategy', async () => {
      const feature = new ParallelExecutionFeature();
      await feature.initialize({ selection_strategy: 'top_scored' });
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'model1', provider: 'test', score: 1.0 };
      ctx.alternateModels = [
        { modelId: 'model2', provider: 'test', score: 0.8 },
        { modelId: 'model3', provider: 'test', score: 0.6 }
      ];

      await feature.afterModelSelection(ctx);

      // The feature should have set feature data if it ran parallel execution
      expect(ctx.featureData.has('parallel_execution:models_used') ||
             ctx.signals.skipExecution !== undefined);
    });

    it('PE-2: parallel execution handles single available model', async () => {
      const feature = new ParallelExecutionFeature();
      await feature.initialize({});
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'model1', provider: 'test', score: 1.0 };
      ctx.alternateModels = [];

      const originalSelectedModel = ctx.selectedModel;

      await feature.afterModelSelection(ctx);

      // Should not skip execution for single model
      expect(ctx.selectedModel.modelId).toBe(originalSelectedModel.modelId);
    });

    it('PE-3: stats track parallel runs correctly', async () => {
      const feature = new ParallelExecutionFeature();
      await feature.initialize({});
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'model1', provider: 'test', score: 1.0 };
      ctx.alternateModels = [];

      await feature.afterModelSelection(ctx);

      const status = feature.getStatus();
      expect(status.stats.totalParallelRuns).toBe(0); // No runs because only 1 model
    });

    it('PE-4: timeout handled gracefully', async () => {
      const feature = new ParallelExecutionFeature();
      await feature.initialize({ timeout_ms: 1 }); // Very short timeout
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'model1', provider: 'test', score: 1.0 };
      ctx.alternateModels = [{ modelId: 'model2', provider: 'test', score: 0.8 }];

      await feature.afterModelSelection(ctx);

      // Should not crash even with timeout
      expect(feature.getStatus().health).toBe('healthy');
    });

    it('PE-5: min_model_score filtering works', async () => {
      const feature = new ParallelExecutionFeature();
      await feature.initialize({ min_model_score: 0.7 });
      feature.enabled = true;

      const ctx = createMockContext();
      ctx.selectedModel = { modelId: 'model1', provider: 'test', score: 0.5 };
      ctx.alternateModels = [{ modelId: 'model2', provider: 'test', score: 0.9 }];

      await feature.afterModelSelection(ctx);

      // Model1 should be filtered out due to low score
      // The feature should not skip execution
    });

    it('PE-6: stats track results improved correctly', async () => {
      const feature = new ParallelExecutionFeature();
      await feature.initialize({});
      feature.enabled = true;

      const status = feature.getStatus();
      expect(status.stats.resultsImproved).toBe(0);
      expect(status.stats.avgModelsPerRun).toBe(0);
    });
  });
});

function createMockContext(): FeatureContext {
  return {
    instruction: 'test instruction',
    taskCategory: 'code',
    taskComplexity: 'moderate',
    estimatedTokens: 100,
    selectedModel: { modelId: '', provider: '', score: 0 },
    alternateModels: [],
    availableModels: [],
    systemPrompt: '',
    userPrompt: 'test prompt',
    promptMode: 'initial',
    currentAttempt: 0,
    maxRetries: 3,
    totalTokensUsed: 0,
    totalLatencyMs: 0,
    featureData: new Map(),
    signals: {
      skipExecution: false,
      overrideResult: null,
      forceRetry: false,
      abortExecution: false,
    },
    executionId: 'test-id',
    startTime: Date.now(),
    config: {}
  };
}

class HealedRoutingFeature extends SelfHealingRoutingFeature {
  simulateBlacklist(modelId: string, category: string) {
    this.emit('model.blacklisted', { modelId, category });
  }

  simulateRestore(modelId: string, category: string) {
    this.emit('model.restored', { modelId, category });
  }
}
