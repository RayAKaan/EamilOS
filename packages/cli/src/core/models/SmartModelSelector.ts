import { OllamaDetector } from '../providers/OllamaDetector.js';
import { ModelDiscovery, ModelProfile, ModelRecommendation } from './ModelDiscovery.js';

export interface TaskComplexity {
  estimatedTokens: number;
  requiresReasoning: boolean;
  requiresCode: boolean;
  requiresLongContext: boolean;
  priority: 'speed' | 'quality' | 'balanced';
}

export interface ModelSelectionResult {
  selectedModel: string;
  provider: string;
  reason: string;
  alternatives: ModelRecommendation[];
  fallbackModel: string;
}

export class SmartModelSelector {
  private modelDiscovery: ModelDiscovery;
  private ollamaDetector: OllamaDetector;

  constructor() {
    this.modelDiscovery = new ModelDiscovery();
    this.ollamaDetector = new OllamaDetector();
  }

  async selectForTask(
    task: string,
    options?: Partial<TaskComplexity>
  ): Promise<ModelSelectionResult> {
    const complexity = this.estimateComplexity(task, options);
    const availableModels = await this.getAvailableModels();

    if (availableModels.length === 0) {
      return this.getDefaultSelection();
    }

    const recommendations = this.rankModels(availableModels, complexity);

    if (recommendations.length === 0) {
      return this.getDefaultSelection();
    }

    const selected = recommendations[0];
    const fallback = this.selectFallback(availableModels);

    return {
      selectedModel: selected.model.id,
      provider: selected.model.provider,
      reason: selected.reason,
      alternatives: recommendations.slice(1, 4),
      fallbackModel: fallback,
    };
  }

  private estimateComplexity(
    task: string,
    options?: Partial<TaskComplexity>
  ): TaskComplexity {
    const taskLower = task.toLowerCase();

    const reasoningKeywords = [
      'analyze', 'reason', 'explain', 'why', 'how', 'compare',
      'evaluate', 'assess', 'design', 'architect', 'plan',
    ];
    const codeKeywords = [
      'code', 'function', 'class', 'implement', 'debug', 'fix',
      'refactor', 'test', 'api', 'script', 'database', 'query',
    ];
    const longContextKeywords = [
      'document', 'file', 'files', 'repo', 'repository', ' codebase',
      'project', 'summarize', 'review', 'audit',
    ];

    const requiresReasoning = reasoningKeywords.some((k) => taskLower.includes(k));
    const requiresCode = codeKeywords.some((k) => taskLower.includes(k));
    const requiresLongContext = longContextKeywords.some((k) => taskLower.includes(k));

    let estimatedTokens = 100;
    if (requiresLongContext) estimatedTokens += 500;
    if (requiresReasoning) estimatedTokens += 200;
    if (requiresCode) estimatedTokens += 300;

    let priority: 'speed' | 'quality' | 'balanced' = 'balanced';
    if (requiresCode && !requiresReasoning) {
      priority = 'balanced';
    } else if (requiresReasoning) {
      priority = 'quality';
    } else if (taskLower.includes('quick') || taskLower.includes('simple')) {
      priority = 'speed';
    }

    return {
      estimatedTokens,
      requiresReasoning,
      requiresCode,
      requiresLongContext,
      priority,
      ...options,
    };
  }

  private async getAvailableModels(): Promise<string[]> {
    const status = await this.ollamaDetector.detect();

    if (!status.running) {
      if (process.env.OPENAI_API_KEY) {
        return ['gpt-4o-mini', 'gpt-4o'];
      }
      return [];
    }

    return status.models.map((m) => m.name);
  }

  private rankModels(
    availableModels: string[],
    complexity: TaskComplexity
  ): ModelRecommendation[] {
    const allProfiles = this.modelDiscovery.getAllModels();
    const scored: ModelRecommendation[] = [];

    for (const modelId of availableModels) {
      const profile = allProfiles.find((m) => m.id === modelId) ||
        this.createAdHocProfile(modelId);

      if (!profile) continue;

      const score = this.calculateScore(profile, complexity);
      const reason = this.generateReason(profile, complexity);

      scored.push({ model: profile, score, reason });
    }

    return scored.sort((a, b) => b.score - a.score);
  }

  private createAdHocProfile(modelId: string): ModelProfile {
    const lower = modelId.toLowerCase();

    let provider = 'ollama';
    if (lower.includes('gpt')) provider = 'openai';
    else if (lower.includes('claude')) provider = 'anthropic';

    let quality: 'basic' | 'good' | 'excellent' = 'good';
    if (lower.includes('mini') || lower.includes('lite')) quality = 'basic';
    if (lower.includes('large') || lower.includes('70b') || lower.includes('pro')) quality = 'excellent';

    let speed: 'fast' | 'medium' | 'slow' = 'medium';
    if (lower.includes('mini') || lower.includes('lite') || lower.includes('3b')) speed = 'fast';
    if (lower.includes('70b') || lower.includes('large')) speed = 'slow';

    return {
      id: modelId,
      provider,
      name: modelId,
      description: `Auto-detected model: ${modelId}`,
      minRAM: provider === 'ollama' ? 4 : 0,
      contextWindow: 8192,
      strengths: [],
      typicalUseCases: [],
      speed,
      quality,
    };
  }

  private calculateScore(profile: ModelProfile, complexity: TaskComplexity): number {
    let score = 50;

    if (complexity.priority === 'quality') {
      const qualityMap = { basic: 10, good: 60, excellent: 100 };
      score = qualityMap[profile.quality];
    } else if (complexity.priority === 'speed') {
      const speedMap = { fast: 100, medium: 60, slow: 20 };
      score = speedMap[profile.speed];
    } else {
      const speedMap = { fast: 60, medium: 80, slow: 40 };
      const qualityMap = { basic: 20, good: 70, excellent: 100 };
      score = (speedMap[profile.speed] + qualityMap[profile.quality]) / 2;
    }

    if (complexity.requiresReasoning && profile.quality === 'excellent') {
      score += 15;
    }
    if (complexity.requiresCode) {
      if (profile.strengths.some((s) => s.includes('code') || s.includes('coding'))) {
        score += 20;
      }
    }
    if (complexity.requiresLongContext && profile.contextWindow >= 16000) {
      score += 10;
    }
    if (complexity.estimatedTokens > 1000 && profile.contextWindow < complexity.estimatedTokens) {
      score -= 30;
    }

    return score;
  }

  private generateReason(profile: ModelProfile, complexity: TaskComplexity): string {
    const reasons: string[] = [];

    if (complexity.requiresCode && profile.strengths.some((s) => s.includes('code'))) {
      reasons.push('good for code tasks');
    }
    if (complexity.requiresReasoning && profile.quality === 'excellent') {
      reasons.push('strong reasoning');
    }
    if (complexity.priority === 'speed' && profile.speed === 'fast') {
      reasons.push('fast responses');
    }
    if (profile.provider === 'ollama') {
      reasons.push('runs locally');
    }

    return reasons.length > 0 ? reasons.join(', ') : 'balanced for task';
  }

  private selectFallback(availableModels: string[]): string {
    const fallbacks: Record<string, string> = {
      ollama: 'phi3:mini',
      openai: 'gpt-4o-mini',
      anthropic: 'claude-3-5-haiku',
    };

    if (availableModels.includes('phi3:mini')) return 'phi3:mini';
    if (availableModels.includes('gpt-4o-mini')) return 'gpt-4o-mini';

    return availableModels[0] || fallbacks.ollama;
  }

  private getDefaultSelection(): ModelSelectionResult {
    const recommendations = this.modelDiscovery.recommendModels({
      priority: 'balanced',
    });

    const top = recommendations[0];

    return {
      selectedModel: top?.model.id || 'phi3:mini',
      provider: top?.model.provider || 'ollama',
      reason: top?.reason || 'default fallback',
      alternatives: recommendations.slice(1, 4),
      fallbackModel: 'phi3:mini',
    };
  }

  static async select(task: string, options?: Partial<TaskComplexity>): Promise<ModelSelectionResult> {
    const selector = new SmartModelSelector();
    return selector.selectForTask(task, options);
  }
}
