import { wilsonScore } from './statistics.js';
import { EnrichmentLibrary } from './EnrichmentLibrary.js';
import type { ExecutionRecord, PromptVariant, EnrichmentType } from './types.js';
import * as crypto from 'crypto';

export interface PromptOptimizerConfig {
  maxVariantsPerBase: number;
  evolutionIntervalMs: number;
  minSamplesForEvolution: number;
  retirementThreshold: number;
  explorationRate: number;
}

export const DEFAULT_PROMPT_OPTIMIZER_CONFIG: PromptOptimizerConfig = {
  maxVariantsPerBase: 10,
  evolutionIntervalMs: 3600000,
  minSamplesForEvolution: 5,
  retirementThreshold: 0.6,
  explorationRate: 0.15,
};

export class PromptOptimizer {
  private config: PromptOptimizerConfig;
  private enrichmentLibrary: EnrichmentLibrary;
  private variants: Map<string, PromptVariant[]> = new Map();
  private basePromptHashes: Set<string> = new Set();
  private evolutionTimer: NodeJS.Timeout | null = null;

  constructor(
    config: Partial<PromptOptimizerConfig> = {},
    enrichmentLibrary?: EnrichmentLibrary
  ) {
    this.config = { ...DEFAULT_PROMPT_OPTIMIZER_CONFIG, ...config };
    this.enrichmentLibrary = enrichmentLibrary || new EnrichmentLibrary();
  }

  initialize(): void {
    if (this.evolutionTimer) {
      clearInterval(this.evolutionTimer);
    }
    
    this.evolutionTimer = setInterval(() => {
      this.runEvolution();
    }, this.config.evolutionIntervalMs);
  }

  shutdown(): void {
    if (this.evolutionTimer) {
      clearInterval(this.evolutionTimer);
      this.evolutionTimer = null;
    }
  }

  registerBasePrompt(promptText: string, role: string, taskType: string, model: string): string {
    const hash = this.hashPrompt(promptText);
    this.basePromptHashes.add(hash);
    this.enrichmentLibrary.registerBasePrompt(hash, promptText);
    
    if (!this.variants.has(hash)) {
      const baseVariant: PromptVariant = {
        id: this.generateVariantId(),
        basePromptHash: hash,
        promptText,
        enrichmentsApplied: [],
        generation: 0,
        role: role as any,
        taskType: taskType as any,
        model,
        usageCount: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
        successRateCI: [0, 1],
        avgTokensOut: 0,
        createdAt: Date.now(),
        lastUsed: 0,
        retired: false,
      };
      this.variants.set(hash, [baseVariant]);
    }
    
    return hash;
  }

  recordExecution(record: ExecutionRecord): void {
    for (const agent of record.agentsUsed) {
      if (!agent.model) continue;
      
      const hash = this.inferBasePromptHash(agent.model, record.taskDomains);
      if (!hash) continue;
      
      const variants = this.variants.get(hash);
      if (!variants) continue;
      
      for (const variant of variants) {
        if (variant.usageCount === 0) {
          continue;
        }
        
        const lastUsedThreshold = Date.now() - 300000;
        if (variant.lastUsed < lastUsedThreshold) {
          continue;
        }
        
        const usageAge = Date.now() - variant.lastUsed;
        const timeWeight = Math.exp(-usageAge / 3600000);
        
        if (Math.random() < timeWeight) {
          variant.usageCount++;
          if (agent.success) {
            variant.successCount++;
          } else {
            variant.failureCount++;
          }
          variant.lastUsed = Date.now();
          
          this.updateVariantStats(variant);
          break;
        }
      }
    }
  }

  private updateVariantStats(variant: PromptVariant): void {
    variant.successRate = variant.successCount / variant.usageCount;
    const ci = wilsonScore(variant.successCount, variant.usageCount);
    variant.successRateCI = [ci.lowerBound, ci.upperBound];
  }

  private inferBasePromptHash(model: string, _taskDomains: string[]): string | null {
    for (const [hash, variants] of this.variants) {
      if (variants.some(v => v.model === model)) {
        return hash;
      }
    }
    return null;
  }

  selectVariant(basePromptHash: string): PromptVariant | null {
    const variants = this.variants.get(basePromptHash);
    if (!variants || variants.length === 0) return null;

    const activeVariants = variants.filter(v => !v.retired);
    if (activeVariants.length === 0) return null;

    const shouldExplore = Math.random() < this.config.explorationRate;

    if (shouldExplore) {
      const randomVariant = activeVariants[Math.floor(Math.random() * activeVariants.length)];
      return randomVariant;
    }

    const candidates = activeVariants.filter(v => v.usageCount >= this.config.minSamplesForEvolution);
    
    if (candidates.length === 0) {
      return activeVariants[0];
    }

    candidates.sort((a, b) => b.successRate - a.successRate);

    const topVariant = candidates[0];
    const secondVariant = candidates[1];

    if (topVariant.successRateCI[0] > (secondVariant?.successRateCI[1] || 0)) {
      return topVariant;
    }

    const selectionProbability = Math.random();
    const cumulativeWeight = candidates.reduce((sum, v) => sum + v.successRate, 0);
    let random = selectionProbability * cumulativeWeight;

    for (const variant of candidates) {
      random -= variant.successRate;
      if (random <= 0) {
        return variant;
      }
    }

    return topVariant;
  }

  enrichPrompt(basePromptHash: string, enrichmentTypes: EnrichmentType[]): string | null {
    const basePrompt = this.enrichmentLibrary.getBasePrompt(basePromptHash);
    if (!basePrompt) return null;

    let enrichedPrompt = basePrompt;

    for (const type of enrichmentTypes) {
      const template = this.enrichmentLibrary.getEnrichment(type);
      if (!template) continue;

      const randomExample = template.examples.length > 0
        ? template.examples[Math.floor(Math.random() * template.examples.length)]
        : '';

      const enriched = this.enrichmentLibrary.applyEnrichment(type, {
        [template.parameters[0] || 'value']: randomExample,
      });

      if (enriched) {
        enrichedPrompt += '\n\n' + enriched;
      }
    }

    return enrichedPrompt;
  }

  createVariant(
    basePromptHash: string,
    enrichments: EnrichmentType[],
    parentVariantId?: string
  ): PromptVariant | null {
    const variants = this.variants.get(basePromptHash);
    if (!variants) return null;

    if (variants.length >= this.config.maxVariantsPerBase) {
      const lowestPerforming = variants
        .filter(v => !v.retired)
        .sort((a, b) => a.successRate - b.successRate)[0];
      
      if (lowestPerforming && lowestPerforming.successRate < this.config.retirementThreshold) {
        lowestPerforming.retired = true;
      } else {
        return null;
      }
    }

    const parentVariant = parentVariantId 
      ? variants.find(v => v.id === parentVariantId)
      : variants.find(v => v.enrichmentsApplied.length === 0);

    const basePrompt = this.enrichmentLibrary.getBasePrompt(basePromptHash);
    if (!basePrompt) return null;

    let enrichedPrompt = basePrompt;
    for (const type of enrichments) {
      const template = this.enrichmentLibrary.getEnrichment(type);
      if (!template) continue;
      
      const randomExample = template.examples.length > 0
        ? template.examples[Math.floor(Math.random() * template.examples.length)]
        : '';
      
      const enriched = this.enrichmentLibrary.applyEnrichment(type, {
        [template.parameters[0] || 'value']: randomExample,
      });
      
      if (enriched) {
        enrichedPrompt += '\n\n' + enriched;
      }
    }

    const newVariant: PromptVariant = {
      id: this.generateVariantId(),
      basePromptHash,
      promptText: enrichedPrompt,
      enrichmentsApplied: enrichments,
      generation: (parentVariant?.generation || 0) + 1,
      parentVariantId,
      role: parentVariant?.role || 'planner',
      taskType: parentVariant?.taskType || 'planning',
      model: parentVariant?.model || 'unknown',
      usageCount: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      successRateCI: [0, 1],
      avgTokensOut: 0,
      createdAt: Date.now(),
      lastUsed: 0,
      retired: false,
    };

    variants.push(newVariant);
    return newVariant;
  }

  private runEvolution(): void {
    for (const [, variants] of this.variants) {
      const evolvedVariants = this.evolvePopulation(variants);
      
      for (const evolved of evolvedVariants) {
        const existing = variants.find(v => v.id === evolved.id);
        if (!existing) {
          variants.push(evolved);
        }
      }
    }
  }

  private evolvePopulation(variants: PromptVariant[]): PromptVariant[] {
    const evolved: PromptVariant[] = [];
    const activeVariants = variants.filter(v => !v.retired && v.usageCount >= this.config.minSamplesForEvolution);

    if (activeVariants.length < 2) return evolved;

    const selectedParent = this.enrichmentLibrary.selectParent(activeVariants);
    if (!selectedParent) return evolved;

    const allEnrichments = this.enrichmentLibrary.getAllEnrichments().map(e => e.type);
    const { newEnrichments, mutationApplied } = this.enrichmentLibrary.evolveEnrichment(
      selectedParent,
      allEnrichments
    );

    if (mutationApplied || Math.random() < 0.3) {
      const newVariant = this.createVariant(
        selectedParent.basePromptHash,
        newEnrichments,
        selectedParent.id
      );
      if (newVariant) {
        evolved.push(newVariant);
      }
    }

    if (activeVariants.length >= 2 && Math.random() < 0.2) {
      const parent1 = this.enrichmentLibrary.selectParent(activeVariants);
      const parent2 = this.enrichmentLibrary.selectParent(activeVariants.filter(v => v.id !== parent1?.id));
      
      if (parent1 && parent2) {
        const crossedEnrichments = this.enrichmentLibrary.crossover(
          parent1.enrichmentsApplied,
          parent2.enrichmentsApplied
        );
        
        const newVariant = this.createVariant(
          parent1.basePromptHash,
          crossedEnrichments,
          parent1.id
        );
        if (newVariant) {
          evolved.push(newVariant);
        }
      }
    }

    return evolved;
  }

  getVariantPerformance(variantId: string): {
    successRate: number;
    confidenceInterval: [number, number];
    sampleSize: number;
    status: 'active' | 'retired';
  } | null {
    for (const variants of this.variants.values()) {
      const variant = variants.find(v => v.id === variantId);
      if (variant) {
        return {
          successRate: variant.successRate,
          confidenceInterval: variant.successRateCI,
          sampleSize: variant.usageCount,
          status: variant.retired ? 'retired' : 'active',
        };
      }
    }
    return null;
  }

  getBestVariant(basePromptHash: string): PromptVariant | null {
    const variants = this.variants.get(basePromptHash);
    if (!variants) return null;

    const activeVariants = variants.filter(v => !v.retired && v.usageCount >= this.config.minSamplesForEvolution);
    if (activeVariants.length === 0) return null;

    return activeVariants.sort((a, b) => b.successRate - a.successRate)[0];
  }

  getRecommendations(basePromptHash: string): {
    recommendedEnrichments: EnrichmentType[];
    reasoning: string;
    expectedImprovement: number;
  } {
    const variants = this.variants.get(basePromptHash);
    if (!variants || variants.length === 0) {
      return {
        recommendedEnrichments: [],
        reasoning: 'No variants found for this base prompt',
        expectedImprovement: 0,
      };
    }

    const bestVariant = this.getBestVariant(basePromptHash);
    const baseVariant = variants.find(v => v.enrichmentsApplied.length === 0);
    const baselineRate = baseVariant?.successRate || 0.5;

    const recentFailures = variants
      .filter(v => v.successRate < baselineRate)
      .flatMap(v => v.enrichmentsApplied);

    const recommended = this.enrichmentLibrary.getRecommendedEnrichments({
      previousFailures: recentFailures,
      lowSuccessRate: baselineRate < 0.7,
    });

    const expectedImprovement = bestVariant 
      ? Math.max(0, bestVariant.successRate - baselineRate)
      : 0;

    return {
      recommendedEnrichments: recommended,
      reasoning: `Based on ${variants.length} variants, ${recommended.length} enrichments recommended`,
      expectedImprovement,
    };
  }

  private hashPrompt(prompt: string): string {
    return crypto.createHash('sha256').update(prompt).digest('hex').substring(0, 16);
  }

  private generateVariantId(): string {
    return `variant_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  getStatistics(): {
    totalBasePrompts: number;
    totalVariants: number;
    activeVariants: number;
    retiredVariants: number;
    averageSuccessRate: number;
  } {
    let totalVariants = 0;
    let activeVariants = 0;
    let retiredVariants = 0;
    let totalSuccessRate = 0;
    let variantsWithData = 0;

    for (const variants of this.variants.values()) {
      totalVariants += variants.length;
      activeVariants += variants.filter(v => !v.retired).length;
      retiredVariants += variants.filter(v => v.retired).length;
      
      for (const variant of variants) {
        if (variant.usageCount > 0) {
          totalSuccessRate += variant.successRate;
          variantsWithData++;
        }
      }
    }

    return {
      totalBasePrompts: this.basePromptHashes.size,
      totalVariants,
      activeVariants,
      retiredVariants,
      averageSuccessRate: variantsWithData > 0 ? totalSuccessRate / variantsWithData : 0,
    };
  }
}
