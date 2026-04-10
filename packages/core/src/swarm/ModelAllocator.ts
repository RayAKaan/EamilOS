import type {
  SpawnedAgent,
  SwarmAgentRole,
  ModelAllocation,
  ModelPerformanceRecord,
  SwarmConstraints,
  TaskAnalysis,
} from './types.js';

export interface ModelCostEstimate {
  model: string;
  inputCostPer1K: number;
  outputCostPer1K: number;
}

const MODEL_COSTS: Record<string, ModelCostEstimate> = {
  'gpt-4o': { model: 'gpt-4o', inputCostPer1K: 0.005, outputCostPer1K: 0.015 },
  'gpt-4o-mini': { model: 'gpt-4o-mini', inputCostPer1K: 0.00015, outputCostPer1K: 0.0006 },
  'claude-3.5-sonnet': { model: 'claude-3.5-sonnet', inputCostPer1K: 0.003, outputCostPer1K: 0.015 },
  'claude-3-opus': { model: 'claude-3-opus', inputCostPer1K: 0.015, outputCostPer1K: 0.075 },
  'deepseek-chat': { model: 'deepseek-chat', inputCostPer1K: 0.00014, outputCostPer1K: 0.00028 },
  'deepseek-coder': { model: 'deepseek-coder', inputCostPer1K: 0.00014, outputCostPer1K: 0.00028 },
  'codellama': { model: 'codellama', inputCostPer1K: 0, outputCostPer1K: 0 },
  'llama': { model: 'llama', inputCostPer1K: 0, outputCostPer1K: 0 },
  'ollama': { model: 'ollama', inputCostPer1K: 0, outputCostPer1K: 0 },
  'local': { model: 'local', inputCostPer1K: 0, outputCostPer1K: 0 },
  'phi3': { model: 'phi3', inputCostPer1K: 0, outputCostPer1K: 0 },
  'qwen2.5': { model: 'qwen2.5', inputCostPer1K: 0, outputCostPer1K: 0 },
  'perplexity-api': { model: 'perplexity-api', inputCostPer1K: 0.001, outputCostPer1K: 0.001 },
};

const ROLE_AFFINITY: Record<SwarmAgentRole, string[]> = {
  planner: ['claude-3.5-sonnet', 'gpt-4o', 'deepseek-chat', 'claude-3-opus'],
  executor: ['deepseek-coder', 'codellama', 'gpt-4o-mini', 'claude-3.5-sonnet'],
  validator: ['phi3', 'qwen2.5', 'gpt-4o-mini', 'local'],
  optimizer: ['gpt-4o', 'claude-3.5-sonnet', 'deepseek-chat', 'gpt-4o-mini'],
  researcher: ['gpt-4o', 'claude-3.5-sonnet', 'perplexity-api', 'claude-3-opus'],
  critic: ['claude-3.5-sonnet', 'gpt-4o', 'claude-3-opus', 'gpt-4o-mini'],
};

export class ModelAllocator {
  private performanceHistory: Map<string, ModelPerformanceRecord> = new Map();
  private constraints: SwarmConstraints;

  constructor(constraints: SwarmConstraints) {
    this.constraints = constraints;
  }

  allocate(agents: SpawnedAgent[], taskAnalysis: TaskAnalysis): ModelAllocation[] {
    const allocations: ModelAllocation[] = [];

    for (const agent of agents) {
      const allocation = this.allocateForAgent(agent, taskAnalysis);
      allocations.push(allocation);
    }

    return allocations;
  }

  allocateForAgent(agent: SpawnedAgent, taskAnalysis: TaskAnalysis): ModelAllocation {
    const candidates = this.getCandidatesForRole(agent.role, taskAnalysis);
    const scored = this.scoreModels(candidates, agent.role, taskAnalysis);

    if (scored.length === 0) {
      return {
        model: 'local',
        reason: 'Fallback to local model - no valid candidates',
        estimatedCostPerCall: 0,
        fallbackChain: ['local'],
      };
    }

    const primary = scored[0];
    const fallbackChain = scored.slice(1, 4).map((s) => s.model);

    return {
      model: primary.model,
      reason: primary.reason,
      estimatedCostPerCall: primary.estimatedCost,
      fallbackChain,
    };
  }

  private getCandidatesForRole(
    role: SwarmAgentRole,
    _taskAnalysis: TaskAnalysis
  ): string[] {
    const affinity = ROLE_AFFINITY[role] || ['local'];
    const allowed = this.constraints.allowedModels;
    const forbidden = this.constraints.forbiddenModels;

    return affinity.filter(
      (model) =>
        allowed.includes(model) && !forbidden.includes(model)
    );
  }

  private scoreModels(
    candidates: string[],
    role: SwarmAgentRole,
    taskAnalysis: TaskAnalysis
  ): Array<{ model: string; score: number; reason: string; estimatedCost: number }> {
    const scored = candidates.map((model) => {
      const affinityScore = this.getAffinityScore(model, role);
      const performanceScore = this.getPerformanceScore(model, role);
      const costScore = this.getCostScore(model);
      const domainScore = this.getDomainScore(model, taskAnalysis);

      const totalScore =
        affinityScore * 0.35 +
        performanceScore * 0.30 +
        costScore * 0.20 +
        domainScore * 0.15;

      const reasons: string[] = [];
      if (affinityScore > 0.8) reasons.push('high role affinity');
      if (performanceScore > 0.7) reasons.push('strong historical performance');
      if (costScore > 0.8) reasons.push('cost-effective');
      if (domainScore > 0.6) reasons.push('domain-appropriate');

      return {
        model,
        score: totalScore,
        reason: reasons.length > 0 ? reasons.join(', ') : 'default selection',
        estimatedCost: this.estimateCost(model, taskAnalysis),
      };
    });

    return scored.sort((a, b) => b.score - a.score);
  }

  private getAffinityScore(model: string, role: SwarmAgentRole): number {
    const affinity = ROLE_AFFINITY[role] || [];
    const index = affinity.indexOf(model);
    if (index === -1) return 0.3;
    return 1 - index * 0.2;
  }

  private getPerformanceScore(model: string, role: SwarmAgentRole): number {
    const key = `${model}:${role}`;
    const record = this.performanceHistory.get(key);
    if (!record) return 0.5;
    return record.successRate;
  }

  private getCostScore(model: string): number {
    const costs = MODEL_COSTS[model];
    if (!costs || costs.inputCostPer1K === 0) return 1.0;

    const avgCost = (costs.inputCostPer1K + costs.outputCostPer1K) / 2;
    const maxCost = 0.075;

    return Math.max(0, 1 - avgCost / maxCost);
  }

  private getDomainScore(model: string, taskAnalysis: TaskAnalysis): number {
    const codingModels = ['deepseek-coder', 'codellama', 'gpt-4o-mini'];
    const reasoningModels = ['claude-3.5-sonnet', 'gpt-4o', 'claude-3-opus'];

    if (taskAnalysis.domains.includes('coding') && codingModels.includes(model)) {
      return 1.0;
    }
    if (taskAnalysis.domains.includes('reasoning') && reasoningModels.includes(model)) {
      return 1.0;
    }

    return 0.5;
  }

  private estimateCost(model: string, analysis: TaskAnalysis): number {
    const costs = MODEL_COSTS[model] || { inputCostPer1K: 0.001, outputCostPer1K: 0.001 };
    const inputTokens = analysis.estimatedSteps * 500;
    const outputTokens = analysis.estimatedSteps * 300;

    return (inputTokens / 1000) * costs.inputCostPer1K +
           (outputTokens / 1000) * costs.outputCostPer1K;
  }

  recordPerformance(model: string, role: SwarmAgentRole, success: boolean, latencyMs: number, cost: number): void {
    const key = `${model}:${role}`;
    const existing = this.performanceHistory.get(key);

    if (existing) {
      const totalCalls = existing.totalCalls + 1;
      existing.successRate = (existing.successRate * existing.totalCalls + (success ? 1 : 0)) / totalCalls;
      existing.avgLatencyMs = (existing.avgLatencyMs * existing.totalCalls + latencyMs) / totalCalls;
      existing.avgCostPerCall = (existing.avgCostPerCall * existing.totalCalls + cost) / totalCalls;
      existing.totalCalls = totalCalls;
    } else {
      this.performanceHistory.set(key, {
        model,
        role,
        successRate: success ? 1 : 0,
        avgLatencyMs: latencyMs,
        avgCostPerCall: cost,
        totalCalls: 1,
      });
    }
  }

  getModelCosts(): Map<string, ModelCostEstimate> {
    return new Map(Object.entries(MODEL_COSTS));
  }

  getPerformanceHistory(): Map<string, ModelPerformanceRecord> {
    return new Map(this.performanceHistory);
  }
}

let globalAllocator: ModelAllocator | null = null;

export function initModelAllocator(constraints: SwarmConstraints): ModelAllocator {
  globalAllocator = new ModelAllocator(constraints);
  return globalAllocator;
}

export function getModelAllocator(): ModelAllocator | null {
  return globalAllocator;
}
