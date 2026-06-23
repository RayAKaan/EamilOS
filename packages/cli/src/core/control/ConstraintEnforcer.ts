import type {
  SwarmConstraints,
  Violation,
  GuardResult,
  SpawnedAgent,
  SwarmMessage,
  ExecutionStrategy,
} from '../swarm/types.js';

export interface ConstraintCheck {
  name: string;
  passed: boolean;
  current?: number;
  limit?: number;
  detail?: string;
}

export class ConstraintEnforcer {
  private constraints: SwarmConstraints;
  private violationHistory: Violation[] = [];

  constructor(constraints: SwarmConstraints) {
    this.constraints = { ...constraints };
  }

  updateConstraints(updates: Partial<SwarmConstraints>): void {
    this.constraints = { ...this.constraints, ...updates };
  }

  getConstraints(): SwarmConstraints {
    return { ...this.constraints };
  }

  guardAgentCreation(currentCount: number): GuardResult {
    const violations: Violation[] = [];

    if (currentCount >= this.constraints.maxAgents) {
      violations.push({
        constraint: 'maxAgents',
        detail: `Agent limit reached: ${currentCount}/${this.constraints.maxAgents}`,
        current: currentCount,
        limit: this.constraints.maxAgents,
      });
    }

    return {
      allowed: violations.length === 0,
      violations,
      suggestion:
        violations.length > 0
          ? 'Remove existing agents or increase maxAgents constraint'
          : undefined,
    };
  }

  guardInference(model: string): GuardResult {
    const violations: Violation[] = [];

    if (this.constraints.forbiddenModels.includes(model)) {
      violations.push({
        constraint: 'forbiddenModels',
        detail: `Model '${model}' is explicitly forbidden`,
        current: 1,
        limit: 0,
      });
    }

    if (!this.constraints.allowedModels.includes(model)) {
      violations.push({
        constraint: 'allowedModels',
        detail: `Model '${model}' is not in the allowed models list`,
        current: 0,
        limit: this.constraints.allowedModels.length,
      });
    }

    return {
      allowed: violations.length === 0,
      violations,
      suggestion:
        violations.length > 0
          ? `Use one of: ${this.constraints.allowedModels.join(', ')}`
          : undefined,
    };
  }

  guardCost(currentCost: number, additionalCost: number = 0): GuardResult {
    const violations: Violation[] = [];
    const projected = currentCost + additionalCost;

    if (projected > this.constraints.maxCostUSD) {
      violations.push({
        constraint: 'maxCostUSD',
        detail: `Projected cost $${projected.toFixed(4)} exceeds budget $${this.constraints.maxCostUSD}`,
        current: currentCost,
        limit: this.constraints.maxCostUSD,
        projected,
      });
    }

    return {
      allowed: violations.length === 0,
      violations,
      suggestion:
        violations.length > 0
          ? 'Reduce task scope or increase budget'
          : undefined,
    };
  }

  guardTick(currentTick: number): GuardResult {
    const violations: Violation[] = [];

    if (currentTick >= this.constraints.maxTicks) {
      violations.push({
        constraint: 'maxTicks',
        detail: `Tick limit reached: ${currentTick}/${this.constraints.maxTicks}`,
        current: currentTick,
        limit: this.constraints.maxTicks,
      });
    }

    return {
      allowed: violations.length === 0,
      violations,
      suggestion:
        violations.length > 0
          ? 'Increase maxTicks or optimize execution'
          : undefined,
    };
  }

  guardWallClock(startTime: number): GuardResult {
    const violations: Violation[] = [];
    const elapsed = (Date.now() - startTime) / 1000;

    if (elapsed >= this.constraints.maxWallClockSeconds) {
      violations.push({
        constraint: 'maxWallClockSeconds',
        detail: `Wall clock limit exceeded: ${elapsed.toFixed(1)}s/${this.constraints.maxWallClockSeconds}s`,
        current: elapsed,
        limit: this.constraints.maxWallClockSeconds,
      });
    }

    return {
      allowed: violations.length === 0,
      violations,
      suggestion:
        violations.length > 0
          ? 'Increase maxWallClockSeconds or reduce task complexity'
          : undefined,
    };
  }

  guardFileSystem(): GuardResult {
    if (this.constraints.noFileSystemWrites) {
      return {
        allowed: false,
        violations: [{
          constraint: 'noFileSystemWrites',
          detail: 'File system writes are disabled',
        }],
        suggestion: 'Remove noFileSystemWrites constraint to enable file operations',
      };
    }

    return { allowed: true };
  }

  guardNetwork(): GuardResult {
    if (this.constraints.noNetworkCalls) {
      return {
        allowed: false,
        violations: [{
          constraint: 'noNetworkCalls',
          detail: 'Network calls are disabled',
        }],
        suggestion: 'Remove noNetworkCalls constraint to enable network access',
      };
    }

    return { allowed: true };
  }

  guardParallelInferences(currentCount: number): GuardResult {
    const violations: Violation[] = [];

    if (currentCount >= this.constraints.maxParallelInferences) {
      violations.push({
        constraint: 'maxParallelInferences',
        detail: `Parallel inference limit reached: ${currentCount}/${this.constraints.maxParallelInferences}`,
        current: currentCount,
        limit: this.constraints.maxParallelInferences,
      });
    }

    return {
      allowed: violations.length === 0,
      violations,
      suggestion:
        violations.length > 0
          ? 'Wait for current inferences to complete'
          : undefined,
    };
  }

  guardStrategy(strategy: ExecutionStrategy): GuardResult {
    const violations: Violation[] = [];

    if (strategy === 'competitive' && this.constraints.maxAgents < 3) {
      violations.push({
        constraint: 'competitiveStrategy',
        detail: 'Competitive strategy requires at least 3 agents',
        current: this.constraints.maxAgents,
        limit: 3,
      });
    }

    return {
      allowed: violations.length === 0,
      violations,
      suggestion:
        violations.length > 0
          ? 'Increase maxAgents or choose a different strategy'
          : undefined,
    };
  }

  checkAgent(agent: SpawnedAgent): GuardResult {
    const violations: Violation[] = [];

    if (!this.guardInference(agent.assignedModel).allowed) {
      const result = this.guardInference(agent.assignedModel);
      violations.push(...result.violations!);
    }

    if (agent.costSoFar > this.constraints.perAgentCostLimit) {
      violations.push({
        constraint: 'perAgentCostLimit',
        detail: `Agent ${agent.id} exceeded cost limit`,
        current: agent.costSoFar,
        limit: this.constraints.perAgentCostLimit,
      });
    }

    return {
      allowed: violations.length === 0,
      violations,
    };
  }

  checkMessage(message: SwarmMessage): GuardResult {
    const violations: Violation[] = [];

    if (message.priority === 'critical' && this.constraints.noNetworkCalls) {
      violations.push({
        constraint: 'noNetworkCalls',
        detail: 'Critical messages blocked when network is disabled',
        current: 1,
        limit: 0,
      });
    }

    return {
      allowed: violations.length === 0,
      violations,
    };
  }

  checkAll(
    agentCount: number,
    currentCost: number,
    currentTick: number,
    startTime: number,
    parallelInferences: number
  ): ConstraintCheck[] {
    const checks: ConstraintCheck[] = [];

    checks.push({
      name: 'maxAgents',
      passed: agentCount < this.constraints.maxAgents,
      current: agentCount,
      limit: this.constraints.maxAgents,
    });

    checks.push({
      name: 'maxCostUSD',
      passed: currentCost < this.constraints.maxCostUSD,
      current: currentCost,
      limit: this.constraints.maxCostUSD,
    });

    checks.push({
      name: 'maxTicks',
      passed: currentTick < this.constraints.maxTicks,
      current: currentTick,
      limit: this.constraints.maxTicks,
    });

    checks.push({
      name: 'wallClock',
      passed: (Date.now() - startTime) / 1000 < this.constraints.maxWallClockSeconds,
      detail: `elapsed: ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    });

    checks.push({
      name: 'maxParallelInferences',
      passed: parallelInferences < this.constraints.maxParallelInferences,
      current: parallelInferences,
      limit: this.constraints.maxParallelInferences,
    });

    checks.push({
      name: 'fileSystem',
      passed: !this.constraints.noFileSystemWrites,
    });

    checks.push({
      name: 'network',
      passed: !this.constraints.noNetworkCalls,
    });

    return checks;
  }

  recordViolation(violation: Violation): void {
    this.violationHistory.push(violation);
  }

  getViolationHistory(): Violation[] {
    return [...this.violationHistory];
  }

  clearViolationHistory(): void {
    this.violationHistory = [];
  }

  getViolationsByConstraint(constraint: string): Violation[] {
    return this.violationHistory.filter((v) => v.constraint === constraint);
  }

  getViolationCount(): number {
    return this.violationHistory.length;
  }

  getConstraintSummary(): Record<string, { limit: number; violations: number }> {
    const summary: Record<string, { limit: number; violations: number }> = {};

    for (const violation of this.violationHistory) {
      if (!summary[violation.constraint]) {
        summary[violation.constraint] = {
          limit: violation.limit || 0,
          violations: 0,
        };
      }
      summary[violation.constraint].violations++;
    }

    return summary;
  }
}

let globalEnforcer: ConstraintEnforcer | null = null;

export function initConstraintEnforcer(constraints: SwarmConstraints): ConstraintEnforcer {
  globalEnforcer = new ConstraintEnforcer(constraints);
  return globalEnforcer;
}

export function getConstraintEnforcer(): ConstraintEnforcer | null {
  return globalEnforcer;
}
