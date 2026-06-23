import type { EnrichmentType, PromptVariant } from './types.js';

export interface EnrichmentLibraryConfig {
  maxVariantsPerBase: number;
  mutationRate: number;
  crossoverRate: number;
  selectionPressure: number;
  minSamplesForEvolution: number;
}

export const DEFAULT_ENRICHMENT_CONFIG: EnrichmentLibraryConfig = {
  maxVariantsPerBase: 10,
  mutationRate: 0.1,
  crossoverRate: 0.2,
  selectionPressure: 0.7,
  minSamplesForEvolution: 5,
};

export class EnrichmentLibrary {
  private config: EnrichmentLibraryConfig;
  private enrichments: Map<EnrichmentType, EnrichmentTemplate> = new Map();
  private basePrompts: Map<string, string> = new Map();

  constructor(config: Partial<EnrichmentLibraryConfig> = {}) {
    this.config = { ...DEFAULT_ENRICHMENT_CONFIG, ...config };
    this.initializeDefaultEnrichments();
  }

  private initializeDefaultEnrichments(): void {
    this.enrichments.set('specificity', {
      type: 'specificity',
      template: 'Specifically, {specific_requirement}.',
      parameters: ['specific_requirement'],
      examples: [
        'create a function that handles null inputs gracefully',
        'implement the algorithm using O(n) time complexity',
        'write the code with proper error handling for edge cases',
      ],
    });

    this.enrichments.set('constraint_addition', {
      type: 'constraint_addition',
      template: 'Constraints: {constraints}.',
      parameters: ['constraints'],
      examples: [
        'must complete within 100ms',
        'memory usage should not exceed 1GB',
        'output format must be valid JSON',
      ],
    });

    this.enrichments.set('chain_of_thought', {
      type: 'chain_of_thought',
      template: 'Think through this step by step:\n1. {step1}\n2. {step2}\n3. {step3}\n\nReason about the solution:',
      parameters: ['step1', 'step2', 'step3'],
      examples: [
        'First, analyze the input structure',
        'Then, identify the key transformation needed',
        'Finally, verify the output matches requirements',
      ],
    });

    this.enrichments.set('failure_context', {
      type: 'failure_context',
      template: 'Common pitfalls to avoid:\n{failures}\n\nEnsure your solution handles these cases:',
      parameters: ['failures'],
      examples: [
        'null pointer exceptions, off-by-one errors, race conditions',
        'integer overflow, division by zero, buffer overflow',
        'memory leaks, infinite loops, deadlocks',
      ],
    });

    this.enrichments.set('example_addition', {
      type: 'example_addition',
      template: 'Example:\nInput: {input_example}\nExpected Output: {output_example}',
      parameters: ['input_example', 'output_example'],
      examples: [],
    });

    this.enrichments.set('role_framing', {
      type: 'role_framing',
      template: 'As a {role}, your task is to {task}. Apply your expertise to {expertise_aspect}.',
      parameters: ['role', 'task', 'expertise_aspect'],
      examples: [
        'senior software engineer, implement this feature, consider performance optimization',
        'security expert, review this code, identify potential vulnerabilities',
      ],
    });

    this.enrichments.set('output_format', {
      type: 'output_format',
      template: 'Format your response as:\n{format_description}\n{format_example}',
      parameters: ['format_description', 'format_example'],
      examples: [
        'JSON object with fields: id, name, value',
        '{ "id": 1, "name": "example", "value": 42 }',
      ],
    });

    this.enrichments.set('negative_examples', {
      type: 'negative_examples',
      template: 'Do NOT:\n{negative_examples}',
      parameters: ['negative_examples'],
      examples: [
        'use global variables, hardcode values, skip validation',
        'ignore error handling, assume valid input, skip testing',
      ],
    });
  }

  registerBasePrompt(basePromptHash: string, promptText: string): void {
    this.basePrompts.set(basePromptHash, promptText);
  }

  getBasePrompt(basePromptHash: string): string | undefined {
    return this.basePrompts.get(basePromptHash);
  }

  getEnrichment(type: EnrichmentType): EnrichmentTemplate | undefined {
    return this.enrichments.get(type);
  }

  getAllEnrichments(): EnrichmentTemplate[] {
    return Array.from(this.enrichments.values());
  }

  getRandomEnrichment(type?: EnrichmentType): EnrichmentTemplate | undefined {
    if (type) {
      return this.enrichments.get(type);
    }
    
    const types = Array.from(this.enrichments.keys());
    const randomType = types[Math.floor(Math.random() * types.length)];
    return this.enrichments.get(randomType);
  }

  applyEnrichment(type: EnrichmentType, params: Record<string, string>): string | undefined {
    const template = this.enrichments.get(type);
    if (!template) return undefined;

    let result = template.template;
    for (const [key, value] of Object.entries(params)) {
      result = result.replace(`{${key}}`, value);
    }
    return result;
  }

  getRecommendedEnrichments(context: {
    taskType?: string;
    previousFailures?: EnrichmentType[];
    lowSuccessRate?: boolean;
  }): EnrichmentType[] {
    const recommendations: EnrichmentType[] = [];
    const usedTypes = new Set(context.previousFailures || []);

    if (context.lowSuccessRate) {
      if (!usedTypes.has('failure_context')) recommendations.push('failure_context');
      if (!usedTypes.has('negative_examples')) recommendations.push('negative_examples');
    }

    if (context.taskType?.includes('code') || context.taskType?.includes('implementation')) {
      if (!usedTypes.has('specificity')) recommendations.push('specificity');
      if (!usedTypes.has('constraint_addition')) recommendations.push('constraint_addition');
    }

    if (!usedTypes.has('chain_of_thought') && recommendations.length < 3) {
      recommendations.push('chain_of_thought');
    }

    if (!usedTypes.has('example_addition') && recommendations.length < 3) {
      recommendations.push('example_addition');
    }

    return recommendations.slice(0, 3);
  }

  evolveEnrichment(
    parentVariant: PromptVariant,
    availableEnrichments: EnrichmentType[]
  ): { newEnrichments: EnrichmentType[]; mutationApplied: boolean } {
    const newEnrichments = [...parentVariant.enrichmentsApplied];
    let mutationApplied = false;

    if (Math.random() < this.config.mutationRate && availableEnrichments.length > 0) {
      const mutationType = availableEnrichments[Math.floor(Math.random() * availableEnrichments.length)];
      
      if (Math.random() < 0.5 && !newEnrichments.includes(mutationType)) {
        newEnrichments.push(mutationType);
        mutationApplied = true;
      } else if (newEnrichments.length > 0) {
        const removeIndex = Math.floor(Math.random() * newEnrichments.length);
        newEnrichments.splice(removeIndex, 1);
        mutationApplied = true;
      }
    }

    return { newEnrichments, mutationApplied };
  }

  crossover(parent1Enrichments: EnrichmentType[], parent2Enrichments: EnrichmentType[]): EnrichmentType[] {
    const child: EnrichmentType[] = [];
    
    const shorter = parent1Enrichments.length <= parent2Enrichments.length 
      ? parent1Enrichments 
      : parent2Enrichments;
    const longer = parent1Enrichments.length > parent2Enrichments.length 
      ? parent1Enrichments 
      : parent2Enrichments;

    for (let i = 0; i < shorter.length; i++) {
      child.push(Math.random() < 0.5 ? parent1Enrichments[i] : parent2Enrichments[i]);
    }

    for (let i = shorter.length; i < longer.length; i++) {
      if (Math.random() < this.config.crossoverRate) {
        child.push(longer[i]);
      }
    }

    return child;
  }

  selectParent(
    variants: PromptVariant[],
    targetSuccessRate: number = 0.8
  ): PromptVariant | null {
    if (variants.length === 0) return null;
    if (variants.length === 1) return variants[0];

    const candidates = variants.filter(v => v.usageCount >= this.config.minSamplesForEvolution);
    
    if (candidates.length === 0) {
      return variants[Math.floor(Math.random() * variants.length)];
    }

    candidates.sort((a, b) => b.successRate - a.successRate);

    const selectionThreshold = targetSuccessRate * this.config.selectionPressure;
    const selected = candidates.filter(v => v.successRate >= selectionThreshold);

    if (selected.length === 0) {
      return candidates[0];
    }

    return selected[Math.floor(Math.random() * selected.length)];
  }

  getStatistics(): {
    totalEnrichments: number;
    totalBasePrompts: number;
    enrichmentsByType: Record<EnrichmentType, number>;
  } {
    const enrichmentsByType: Record<string, number> = {};
    
    for (const [type] of this.enrichments) {
      enrichmentsByType[type] = 0;
    }

    return {
      totalEnrichments: this.enrichments.size,
      totalBasePrompts: this.basePrompts.size,
      enrichmentsByType: enrichmentsByType as Record<EnrichmentType, number>,
    };
  }
}

export interface EnrichmentTemplate {
  type: EnrichmentType;
  template: string;
  parameters: string[];
  examples: string[];
}
