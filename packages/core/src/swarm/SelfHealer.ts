import { EventEmitter } from 'events';
import type {
  SpawnedAgent,
  FailureRecord,
  FailureType,
  HealingAction,
  HealingStrategy,
  Subtask,
  SwarmConstraints,
} from './types.js';

export interface HealingConfig {
  maxRetries: number;
  maxRetriesPerAgent: number;
  escalationThreshold: number;
  recoveryTimeoutMs: number;
}

const DEFAULT_CONFIG: HealingConfig = {
  maxRetries: 5,
  maxRetriesPerAgent: 3,
  escalationThreshold: 3,
  recoveryTimeoutMs: 10000,
};

export class SelfHealer extends EventEmitter {
  private config: HealingConfig;
  private constraints: SwarmConstraints;
  private failures: Map<string, FailureRecord> = new Map();
  private agentFailureCounts: Map<string, number> = new Map();
  private modelFallbacks: Map<string, string[]> = new Map();

  constructor(constraints: SwarmConstraints, config?: Partial<HealingConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.constraints = constraints;
  }

  handleFailure(
    agentId: string,
    type: FailureType,
    error: string,
    relatedSubtask?: string
  ): HealingStrategy | null {
    const failureRecord: FailureRecord = {
      id: `failure-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      agentId,
      type,
      error,
      timestamp: Date.now(),
      attemptNumber: this.getAttemptNumber(agentId),
      recovered: false,
      relatedSubtask,
    };

    this.failures.set(failureRecord.id, failureRecord);

    const agentFailureCount = this.incrementFailureCount(agentId);

    if (agentFailureCount >= this.config.escalationThreshold) {
      return this.createEscalationStrategy(agentId, type, error);
    }

    if (agentFailureCount >= this.config.maxRetriesPerAgent) {
      return this.createReplaceStrategy(agentId, type);
    }

    return this.createRetryStrategy(agentId, type, error);
  }

  private getAttemptNumber(agentId: string): number {
    return this.agentFailureCounts.get(agentId) || 0;
  }

  private incrementFailureCount(agentId: string): number {
    const current = this.agentFailureCounts.get(agentId) || 0;
    const next = current + 1;
    this.agentFailureCounts.set(agentId, next);
    return next;
  }

  private createRetryStrategy(agentId: string, type: FailureType, error: string): HealingStrategy {
    let action: HealingAction = 'retry-same';

    switch (type) {
      case 'timeout':
        action = 'retry-same';
        break;
      case 'error':
      case 'invalid-output':
        action = 'retry-same';
        break;
      case 'model-unavailable':
        action = 'retry-different-model';
        break;
      case 'cost-exceeded':
        action = 'skip-subtask';
        break;
      case 'unresponsive':
        action = 'retry-different-model';
        break;
    }

    return {
      attempt: this.getAttemptNumber(agentId),
      action,
      reason: `Retry ${action} due to ${type}: ${error}`,
    };
  }

  private createReplaceStrategy(agentId: string, type: FailureType): HealingStrategy {
    return {
      attempt: this.getAttemptNumber(agentId),
      action: 'replace-agent',
      reason: `Agent ${agentId} exceeded max retries (${type})`,
    };
  }

  private createEscalationStrategy(
    agentId: string,
    type: FailureType,
    error: string
  ): HealingStrategy {
    return {
      attempt: this.getAttemptNumber(agentId),
      action: 'escalate-to-operator',
      reason: `Critical failure requiring operator intervention: ${type} - ${error}`,
    };
  }

  executeHealingAction(
    strategy: HealingStrategy,
    agent: SpawnedAgent,
    fallbackModel?: string
  ): { newAgent?: SpawnedAgent; shouldTerminate: boolean; shouldRetry: boolean } {
    switch (strategy.action) {
      case 'retry-same':
        return { shouldTerminate: false, shouldRetry: true };

      case 'retry-different-model':
        const newModel = fallbackModel || this.selectAlternativeModel(agent);
        if (newModel) {
          return {
            shouldTerminate: false,
            shouldRetry: true,
            newAgent: { ...agent, assignedModel: newModel, failureCount: 0 },
          };
        }
        return this.executeHealingAction(
          { ...strategy, action: 'replace-agent' },
          agent
        );

      case 'replace-agent':
        return {
          shouldTerminate: true,
          shouldRetry: true,
          newAgent: {
            ...agent,
            id: `${agent.role}-${Math.random().toString(36).slice(2, 6)}`,
            failureCount: 0,
          },
        };

      case 'skip-subtask':
        return { shouldTerminate: true, shouldRetry: false };

      case 'terminate':
        return { shouldTerminate: true, shouldRetry: false };

      case 'escalate-to-operator':
        this.emit('healing:escalate', {
          agent,
          strategy,
          reason: strategy.reason,
        });
        return { shouldTerminate: true, shouldRetry: false };

      default:
        return { shouldTerminate: false, shouldRetry: true };
    }
  }

  private selectAlternativeModel(agent: SpawnedAgent): string | undefined {
    const fallbacks = this.modelFallbacks.get(agent.id);
    if (fallbacks && fallbacks.length > 0) {
      const nextModel = fallbacks.shift();
      this.modelFallbacks.set(agent.id, fallbacks);
      return nextModel;
    }

    const allModels = this.constraints.allowedModels.filter(
      (m) => !this.constraints.forbiddenModels.includes(m)
    );

    const alternatives = allModels.filter((m) => m !== agent.assignedModel);
    if (alternatives.length > 0) {
      return alternatives[Math.floor(Math.random() * alternatives.length)];
    }

    return 'local';
  }

  setModelFallbackChain(agentId: string, chain: string[]): void {
    this.modelFallbacks.set(agentId, chain);
  }

  recordRecovery(failureId: string): void {
    const record = this.failures.get(failureId);
    if (record) {
      record.recovered = true;
      record.healingAction = this.determineActionFromRecovery();
      this.failures.set(failureId, record);
    }
  }

  private determineActionFromRecovery(): HealingAction {
    return 'retry-same';
  }

  getFailureHistory(): FailureRecord[] {
    return Array.from(this.failures.values());
  }

  getFailureHistoryForAgent(agentId: string): FailureRecord[] {
    return Array.from(this.failures.values()).filter((f) => f.agentId === agentId);
  }

  getAgentFailureCount(agentId: string): number {
    return this.agentFailureCounts.get(agentId) || 0;
  }

  resetAgentFailures(agentId: string): void {
    this.agentFailureCounts.delete(agentId);
  }

  isAgentHealthy(agentId: string): boolean {
    return this.getAgentFailureCount(agentId) < this.config.maxRetriesPerAgent;
  }

  getSwarmHealth(): {
    overallHealth: number;
    agentHealth: Map<string, boolean>;
    recentFailures: number;
    recoveryRate: number;
  } {
    const allFailures = Array.from(this.failures.values());
    const recentFailures = allFailures.filter(
      (f) => Date.now() - f.timestamp < 60000
    );

    const recoveries = allFailures.filter((f) => f.recovered);
    const recoveryRate = allFailures.length > 0 ? recoveries.length / allFailures.length : 1;

    const agentHealth = new Map<string, boolean>();
    for (const [agentId] of this.agentFailureCounts) {
      agentHealth.set(agentId, this.isAgentHealthy(agentId));
    }

    const healthyAgents = Array.from(agentHealth.values()).filter(Boolean).length;
    const overallHealth = agentHealth.size > 0
      ? healthyAgents / agentHealth.size
      : 1;

    return {
      overallHealth,
      agentHealth,
      recentFailures: recentFailures.length,
      recoveryRate,
    };
  }

  pruneOldFailures(maxAgeMs: number = 3600000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, record] of this.failures) {
      if (record.timestamp < cutoff) {
        this.failures.delete(id);
      }
    }
  }

  markSubtaskBlocked(subtask: Subtask): void {
    subtask.status = 'blocked';
    this.emit('subtask:blocked', { subtask });
  }

  unblockSubtask(subtask: Subtask): void {
    if (subtask.status === 'blocked') {
      subtask.status = 'unclaimed';
      this.emit('subtask:unblocked', { subtask });
    }
  }
}

let globalHealer: SelfHealer | null = null;

export function initSelfHealer(constraints: SwarmConstraints): SelfHealer {
  globalHealer = new SelfHealer(constraints);
  return globalHealer;
}

export function getSelfHealer(): SelfHealer | null {
  return globalHealer;
}
