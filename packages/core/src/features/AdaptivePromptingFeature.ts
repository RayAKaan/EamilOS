import { Feature, FeatureContext, FeatureStatus } from './types.js';
import { MetricsStore } from '../model-router/MetricsStore.js';

interface ModelPromptProfile {
  alwaysNuclear: boolean;
  maxInstructionLength: number;
  addExplicitJsonReminder: boolean;
  addNoMarkdownRule: boolean;
  addNoExplanationRule: boolean;
  useSimplifiedVocabulary: boolean;
  prependFormatExample: boolean;
  customSystemPromptSuffix: string;
}

export class AdaptivePromptingFeature implements Feature {
  readonly id = 'adaptive_prompting';
  readonly name = 'Adaptive Prompting';
  readonly description = 'Automatically adapts prompts based on model capabilities and history';
  enabled = false;

  private config = {
    strategy: 'per_model' as 'per_model' | 'per_category' | 'per_model_category',
    useMetrics: true,
    strictThreshold: 0.6,
    nuclearThreshold: 0.3,
    customProfiles: {} as Record<string, Partial<ModelPromptProfile>>,
  };

  private static readonly DEFAULT_PROFILE: ModelPromptProfile = {
    alwaysNuclear: false,
    maxInstructionLength: 10000,
    addExplicitJsonReminder: true,
    addNoMarkdownRule: true,
    addNoExplanationRule: true,
    useSimplifiedVocabulary: false,
    prependFormatExample: false,
    customSystemPromptSuffix: '',
  };

  private static readonly KNOWN_PROFILES: Record<string, Partial<ModelPromptProfile>> = {
    'phi3': {
      alwaysNuclear: true,
      maxInstructionLength: 3000,
      addExplicitJsonReminder: true,
      addNoMarkdownRule: true,
      addNoExplanationRule: true,
      useSimplifiedVocabulary: true,
      prependFormatExample: true,
    },
    'phi': {
      alwaysNuclear: true,
      maxInstructionLength: 3000,
      useSimplifiedVocabulary: true,
      prependFormatExample: true,
    },
    'llama': {
      addExplicitJsonReminder: true,
      addNoMarkdownRule: true,
      prependFormatExample: true,
    },
    'mistral': {
      addExplicitJsonReminder: true,
      addNoMarkdownRule: true,
    },
    'deepseek': {
      addExplicitJsonReminder: true,
      maxInstructionLength: 8000,
    },
    'gpt-4': {
      alwaysNuclear: false,
      addExplicitJsonReminder: false,
      addNoMarkdownRule: false,
      addNoExplanationRule: false,
      useSimplifiedVocabulary: false,
      prependFormatExample: false,
      maxInstructionLength: 30000,
    },
    'gpt-3.5': {
      addExplicitJsonReminder: true,
      addNoMarkdownRule: true,
    },
    'claude': {
      addExplicitJsonReminder: true,
      addNoMarkdownRule: false,
      maxInstructionLength: 30000,
    },
  };

  private metricsStore: MetricsStore | null = null;
  private stats = {
    promptsAdapted: 0,
    nuclearPromotions: 0,
    strictPromotions: 0,
  };
  private errors: string[] = [];

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config.strategy = (config.strategy as any) || 'per_model';
    this.config.useMetrics = config.use_metrics !== false;
    this.config.strictThreshold = (config.strict_threshold as number) || 0.6;
    this.config.nuclearThreshold = (config.nuclear_threshold as number) || 0.3;
    this.config.customProfiles = (config.custom_profiles as any) || {};
  }

  setMetricsStore(store: MetricsStore): void {
    this.metricsStore = store;
  }

  getStatus(): FeatureStatus {
    return {
      id: this.id,
      enabled: this.enabled,
      initialized: true,
      health: 'healthy',
      stats: {
        promptsAdapted: this.stats.promptsAdapted,
        nuclearPromotions: this.stats.nuclearPromotions,
        strictPromotions: this.stats.strictPromotions,
      },
      lastActivity: new Date().toISOString(),
      errors: this.errors.slice(-10)
    };
  }

  async beforeExecution(ctx: FeatureContext): Promise<void> {
    const modelId = ctx.selectedModel.modelId;
    const profile = this.getProfile(modelId, ctx.taskCategory);

    if (profile.alwaysNuclear && ctx.promptMode === 'initial') {
      ctx.promptMode = 'nuclear';
      ctx.systemPrompt = this.getNuclearSystemPrompt();
      this.stats.nuclearPromotions++;
    }

    if (this.config.useMetrics && this.metricsStore) {
      const metrics = this.metricsStore.getMetrics(modelId);
      if (metrics) {
        if (metrics.jsonComplianceRate < this.config.nuclearThreshold && ctx.promptMode !== 'nuclear') {
          ctx.promptMode = 'nuclear';
          ctx.systemPrompt = this.getNuclearSystemPrompt();
          this.stats.nuclearPromotions++;
        } else if (metrics.jsonComplianceRate < this.config.strictThreshold && ctx.promptMode === 'initial') {
          ctx.promptMode = 'strict';
          this.stats.strictPromotions++;
        }
      }
    }

    if (ctx.userPrompt.length > profile.maxInstructionLength) {
      ctx.userPrompt = ctx.userPrompt.substring(0, profile.maxInstructionLength) +
        '\n\n[Instruction truncated to ' + profile.maxInstructionLength + ' characters]';
    }

    if (profile.useSimplifiedVocabulary) {
      ctx.userPrompt = this.simplifyVocabulary(ctx.userPrompt);
    }

    if (profile.prependFormatExample) {
      ctx.userPrompt = this.getFormatExample() + '\n\n' + ctx.userPrompt;
    }

    if (profile.addExplicitJsonReminder) {
      ctx.userPrompt += '\n\nREMEMBER: Output ONLY valid JSON. No other text.';
    }

    if (profile.addNoMarkdownRule) {
      ctx.userPrompt += '\nDo NOT use markdown formatting or code blocks.';
    }

    if (profile.addNoExplanationRule) {
      ctx.userPrompt += '\nDo NOT explain your code. Just output the JSON.';
    }

    if (profile.customSystemPromptSuffix) {
      ctx.systemPrompt += '\n' + profile.customSystemPromptSuffix;
    }

    this.stats.promptsAdapted++;
    ctx.featureData.set('adaptive_prompting:profile_used', this.getProfileName(modelId));
    ctx.featureData.set('adaptive_prompting:prompt_mode', ctx.promptMode);
  }

  private getProfile(modelId: string, _category: string): ModelPromptProfile {
    const base = { ...AdaptivePromptingFeature.DEFAULT_PROFILE };

    for (const [familyKey, familyProfile] of Object.entries(AdaptivePromptingFeature.KNOWN_PROFILES)) {
      if (modelId.toLowerCase().includes(familyKey.toLowerCase())) {
        Object.assign(base, familyProfile);
        break;
      }
    }

    const customProfile = this.config.customProfiles[modelId];
    if (customProfile) {
      Object.assign(base, customProfile);
    }

    return base;
  }

  private getProfileName(modelId: string): string {
    if (this.config.customProfiles[modelId]) return `custom:${modelId}`;

    for (const familyKey of Object.keys(AdaptivePromptingFeature.KNOWN_PROFILES)) {
      if (modelId.toLowerCase().includes(familyKey.toLowerCase())) {
        return `known:${familyKey}`;
      }
    }

    return 'default';
  }

  private simplifyVocabulary(prompt: string): string {
    return prompt
      .replace(/implement/gi, 'create')
      .replace(/utilize/gi, 'use')
      .replace(/demonstrate/gi, 'show')
      .replace(/construct/gi, 'build')
      .replace(/instantiate/gi, 'create')
      .replace(/functionality/gi, 'feature')
      .replace(/subsequently/gi, 'then')
      .replace(/comprehensive/gi, 'complete')
      .replace(/furthermore/gi, 'also')
      .replace(/nevertheless/gi, 'but')
      .replace(/approximately/gi, 'about');
  }

  private getFormatExample(): string {
    return 'YOUR OUTPUT MUST LOOK EXACTLY LIKE THIS:\n' +
      '{"summary":"what you made","files":[{"path":"filename.py","content":"your code here","language":"python"}]}\n' +
      'NOTHING ELSE. JUST THE JSON.';
  }

  private getNuclearSystemPrompt(): string {
    return 'JSON ONLY. No text. No markdown. No explanation.\n' +
      '{"summary":"...","files":[{"path":"file.ext","content":"code","language":"lang"}]}\n' +
      'Your output goes directly to JSON.parse(). Extra text = rejection.';
  }
}
