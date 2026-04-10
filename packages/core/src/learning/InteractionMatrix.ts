import type { SwarmAgentRole } from '../swarm/types.js';

export interface InteractionScore {
  pair: string;
  successRate: number;
  sampleSize: number;
  confidence: number;
  lastUpdated: number;
}

export interface InteractionConfig {
  minSamples: number;
  decayFactor: number;
  maxPairs: number;
}

export const DEFAULT_INTERACTION_CONFIG: InteractionConfig = {
  minSamples: 3,
  decayFactor: 0.95,
  maxPairs: 1000,
};

export class InteractionMatrix {
  private config: InteractionConfig;
  private interactions: Map<string, InteractionData> = new Map();
  private roleCombinations: Map<string, RoleCombination> = new Map();

  constructor(config: Partial<InteractionConfig> = {}) {
    this.config = { ...DEFAULT_INTERACTION_CONFIG, ...config };
  }

  getPairKey(role1: SwarmAgentRole, role2: SwarmAgentRole): string {
    return `${role1}->${role2}`;
  }

  recordInteraction(
    role1: SwarmAgentRole,
    role2: SwarmAgentRole,
    success: boolean,
    metadata?: InteractionMetadata
  ): void {
    const key = this.getPairKey(role1, role2);
    let data = this.interactions.get(key);

    if (!data) {
      data = {
        pair: key,
        role1,
        role2,
        successes: 0,
        total: 0,
        latencySum: 0,
        lastUpdated: Date.now(),
        historical: [],
      };
      this.interactions.set(key, data);
    }

    data.total++;
    if (success) {
      data.successes++;
    }
    if (metadata?.latencyMs) {
      data.latencySum += metadata.latencyMs;
    }
    data.lastUpdated = Date.now();

    data.historical.push({
      timestamp: Date.now(),
      success,
      latencyMs: metadata?.latencyMs,
    });

    if (data.historical.length > 100) {
      data.historical = data.historical.slice(-100);
    }

    if (this.interactions.size > this.config.maxPairs) {
      this.pruneOldest();
    }

    this.updateRoleCombination(role1, role2, success);
  }

  private updateRoleCombination(
    role1: SwarmAgentRole,
    role2: SwarmAgentRole,
    success: boolean
  ): void {
    const comboKey = this.getCombinationKey(role1, role2);
    let combo = this.roleCombinations.get(comboKey);

    if (!combo) {
      combo = {
        roles: [role1, role2],
        ema: success ? 1 : 0,
        sampleSize: 0,
      };
      this.roleCombinations.set(comboKey, combo);
    }

    combo.sampleSize++;
    combo.ema = this.config.decayFactor * combo.ema + (success ? 1 : 0) * (1 - this.config.decayFactor);
  }

  private getCombinationKey(role1: SwarmAgentRole, role2: SwarmAgentRole): string {
    const sorted = [role1, role2].sort();
    return sorted.join('+');
  }

  getScore(role1: SwarmAgentRole, role2: SwarmAgentRole): InteractionScore {
    const key = this.getPairKey(role1, role2);
    const data = this.interactions.get(key);

    if (!data) {
      return {
        pair: key,
        successRate: 0.5,
        sampleSize: 0,
        confidence: 0,
        lastUpdated: Date.now(),
      };
    }

    if (data.total === 0) {
      return {
        pair: key,
        successRate: 0.5,
        sampleSize: 0,
        confidence: 0,
        lastUpdated: data.lastUpdated,
      };
    }

    const successRate = data.successes / data.total;
    const confidence = Math.min(1, data.total / this.config.minSamples);

    return {
      pair: key,
      successRate,
      sampleSize: data.total,
      confidence: data.total >= this.config.minSamples ? confidence : 0,
      lastUpdated: data.lastUpdated,
    };
  }

  getCombinationScore(role1: SwarmAgentRole, role2: SwarmAgentRole): number {
    const comboKey = this.getCombinationKey(role1, role2);
    const combo = this.roleCombinations.get(comboKey);

    if (!combo) {
      return 0.5;
    }

    return combo.ema;
  }

  getAllScores(): InteractionScore[] {
    const scores: InteractionScore[] = [];

    for (const [key, data] of this.interactions) {
      scores.push({
        pair: key,
        successRate: data.total > 0 ? data.successes / data.total : 0,
        sampleSize: data.total,
        confidence: Math.min(1, data.total / 20),
        lastUpdated: data.lastUpdated,
      });
    }

    return scores.sort((a, b) => b.sampleSize - a.sampleSize);
  }

  getTopCombinations(limit: number = 10): Array<{
    pair: string;
    score: number;
    sampleSize: number;
  }> {
    const combos: Array<{ pair: string; score: number; sampleSize: number }> = [];

    for (const [key, data] of this.interactions) {
      combos.push({
        pair: key,
        score: data.total > 0 ? data.successes / data.total : 0,
        sampleSize: data.total,
      });
    }

    return combos
      .filter(c => c.sampleSize >= this.config.minSamples)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  getIncompatiblePairs(): string[] {
    const incompatible: string[] = [];

    for (const [key, data] of this.interactions) {
      if (data.total >= 10 && data.successes / data.total < 0.3) {
        incompatible.push(key);
      }
    }

    return incompatible;
  }

  getCompatiblePairs(minRate: number = 0.7): string[] {
    const compatible: string[] = [];

    for (const [key, data] of this.interactions) {
      if (data.total >= 5 && data.successes / data.total >= minRate) {
        compatible.push(key);
      }
    }

    return compatible;
  }

  adjustModelScore(
    baseScore: number,
    role1: SwarmAgentRole,
    role2: SwarmAgentRole
  ): number {
    const comboScore = this.getCombinationScore(role1, role2);

    const factor = comboScore > 0.5
      ? 1 + (comboScore - 0.5) * 0.3
      : 1 - (0.5 - comboScore) * 0.5;

    return Math.max(0, Math.min(1, baseScore * factor));
  }

  private pruneOldest(): void {
    const entries = Array.from(this.interactions.entries());
    entries.sort((a, b) => a[1].lastUpdated - b[1].lastUpdated);

    const toRemove = entries.slice(0, Math.floor(entries.length * 0.2));
    for (const [key] of toRemove) {
      this.interactions.delete(key);
    }
  }

  getStatistics(): InteractionStatistics {
    let totalInteractions = 0;
    let totalSuccesses = 0;
    let lowConfidence = 0;
    let highConfidence = 0;

    for (const data of this.interactions.values()) {
      totalInteractions += data.total;
      totalSuccesses += data.successes;

      if (data.total < 10) {
        lowConfidence++;
      } else {
        highConfidence++;
      }
    }

    return {
      totalPairs: this.interactions.size,
      totalInteractions,
      overallSuccessRate: totalInteractions > 0 ? totalSuccesses / totalInteractions : 0,
      lowConfidencePairs: lowConfidence,
      highConfidencePairs: highConfidence,
      avgSampleSize: this.interactions.size > 0
        ? totalInteractions / this.interactions.size
        : 0,
    };
  }

  clear(): void {
    this.interactions.clear();
    this.roleCombinations.clear();
  }
}

interface InteractionData {
  pair: string;
  role1: SwarmAgentRole;
  role2: SwarmAgentRole;
  successes: number;
  total: number;
  latencySum: number;
  lastUpdated: number;
  historical: Array<{
    timestamp: number;
    success: boolean;
    latencyMs?: number;
  }>;
}

interface RoleCombination {
  roles: [SwarmAgentRole, SwarmAgentRole];
  ema: number;
  sampleSize: number;
}

export interface InteractionMetadata {
  latencyMs?: number;
  taskComplexity?: string;
  errorType?: string;
}

export interface InteractionStatistics {
  totalPairs: number;
  totalInteractions: number;
  overallSuccessRate: number;
  lowConfidencePairs: number;
  highConfidencePairs: number;
  avgSampleSize: number;
}
