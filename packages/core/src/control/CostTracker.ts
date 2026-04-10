import { EventEmitter } from 'events';

export interface CostSnapshot {
  timestamp: number;
  totalCost: number;
  agentCosts: Map<string, number>;
  modelCosts: Map<string, number>;
  tickCosts: number[];
}

export interface CostAlert {
  id: string;
  threshold: number;
  actualCost: number;
  percentage: number;
  timestamp: number;
  acknowledged: boolean;
}

export interface CostForecast {
  estimatedTotalCost: number;
  projectedCompletionTick: number;
  confidence: number;
  risk: 'low' | 'medium' | 'high' | 'critical';
}

export class CostTracker extends EventEmitter {
  private budget: number;
  private currentCost: number = 0;
  private agentCosts: Map<string, number> = new Map();
  private modelCosts: Map<string, number> = new Map();
  private tickCosts: number[] = [];
  private alerts: CostAlert[] = [];
  private alertThresholds: number[] = [0.5, 0.75, 0.9, 0.95, 1.0];
  private costPerToken: Map<string, { input: number; output: number }> = new Map();
  private startTime: number = 0;
  private startTick: number = 0;

  constructor(budget: number) {
    super();
    this.budget = budget;
    this.initializeDefaultCosts();
  }

  private initializeDefaultCosts(): void {
    this.costPerToken.set('gpt-4o', { input: 0.000005, output: 0.000015 });
    this.costPerToken.set('gpt-4o-mini', { input: 0.00000015, output: 0.0000006 });
    this.costPerToken.set('claude-3.5-sonnet', { input: 0.000003, output: 0.000015 });
    this.costPerToken.set('claude-3-opus', { input: 0.000015, output: 0.000075 });
    this.costPerToken.set('deepseek-chat', { input: 0.00000014, output: 0.00000028 });
    this.costPerToken.set('deepseek-coder', { input: 0.00000014, output: 0.00000028 });
    this.costPerToken.set('perplexity-api', { input: 0.000001, output: 0.000001 });
  }

  startTracking(tick: number = 0): void {
    this.startTime = Date.now();
    this.startTick = tick;
  }

  getElapsedTime(): number {
    return this.startTime > 0 ? Date.now() - this.startTime : 0;
  }

  getStartTick(): number {
    return this.startTick;
  }

  recordInference(
    agentId: string,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const rates = this.costPerToken.get(model) || { input: 0.000001, output: 0.000001 };
    const cost = inputTokens * rates.input + outputTokens * rates.output;

    this.currentCost += cost;

    const currentAgentCost = this.agentCosts.get(agentId) || 0;
    this.agentCosts.set(agentId, currentAgentCost + cost);

    const currentModelCost = this.modelCosts.get(model) || 0;
    this.modelCosts.set(model, currentModelCost + cost);

    this.checkThresholds();

    this.emit('cost:recorded', { agentId, model, cost, totalCost: this.currentCost });

    return cost;
  }

  recordTickCost(cost: number): void {
    this.tickCosts.push(cost);
    this.currentCost += cost;
    this.checkThresholds();
  }

  private checkThresholds(): void {
    const percentage = this.currentCost / this.budget;

    for (const threshold of this.alertThresholds) {
      if (percentage >= threshold) {
        const existingAlert = this.alerts.find((a) => a.threshold === threshold && !a.acknowledged);

        if (!existingAlert) {
          const alert: CostAlert = {
            id: `alert-${Date.now()}-${threshold}`,
            threshold,
            actualCost: this.currentCost,
            percentage,
            timestamp: Date.now(),
            acknowledged: false,
          };

          this.alerts.push(alert);
          this.emit('cost:alert', alert);

          if (percentage >= 1.0) {
            this.emit('cost:exceeded', {
              cost: this.currentCost,
              budget: this.budget,
            });
          }
        }
      }
    }
  }

  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      this.emit('alert:acknowledged', alert);
    }
  }

  acknowledgeAllAlerts(): void {
    for (const alert of this.alerts) {
      alert.acknowledged = true;
    }
    this.emit('alerts:acknowledged');
  }

  getCurrentCost(): number {
    return this.currentCost;
  }

  getBudget(): number {
    return this.budget;
  }

  getRemainingBudget(): number {
    return Math.max(0, this.budget - this.currentCost);
  }

  getBudgetPercentage(): number {
    return (this.currentCost / this.budget) * 100;
  }

  isOverBudget(): boolean {
    return this.currentCost >= this.budget;
  }

  getAgentCost(agentId: string): number {
    return this.agentCosts.get(agentId) || 0;
  }

  getModelCost(model: string): number {
    return this.modelCosts.get(model) || 0;
  }

  getAgentCosts(): Map<string, number> {
    return new Map(this.agentCosts);
  }

  getModelCosts(): Map<string, number> {
    return new Map(this.modelCosts);
  }

  getTickCosts(): number[] {
    return [...this.tickCosts];
  }

  getAlerts(includeAcknowledged: boolean = false): CostAlert[] {
    if (includeAcknowledged) {
      return [...this.alerts];
    }
    return this.alerts.filter((a) => !a.acknowledged);
  }

  getUnacknowledgedAlerts(): CostAlert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  getSnapshot(): CostSnapshot {
    return {
      timestamp: Date.now(),
      totalCost: this.currentCost,
      agentCosts: new Map(this.agentCosts),
      modelCosts: new Map(this.modelCosts),
      tickCosts: [...this.tickCosts],
    };
  }

  forecast(currentTick: number, avgCostPerTick: number): CostForecast {
    const ticksRemaining = Math.max(0, avgCostPerTick > 0 ? this.getRemainingBudget() / avgCostPerTick : Infinity);
    const estimatedTotalCost = this.currentCost + ticksRemaining * avgCostPerTick;

    let confidence = 0.9;
    if (this.tickCosts.length < 5) {
      confidence = 0.5;
    } else if (this.tickCosts.length < 10) {
      confidence = 0.7;
    }

    let risk: CostForecast['risk'] = 'low';
    if (estimatedTotalCost > this.budget * 1.5) {
      risk = 'critical';
    } else if (estimatedTotalCost > this.budget * 1.2) {
      risk = 'high';
    } else if (estimatedTotalCost > this.budget) {
      risk = 'medium';
    }

    return {
      estimatedTotalCost,
      projectedCompletionTick: currentTick + Math.floor(ticksRemaining),
      confidence,
      risk,
    };
  }

  setBudget(newBudget: number): void {
    this.budget = newBudget;
    this.checkThresholds();
    this.emit('budget:updated', { budget: newBudget });
  }

  setAlertThresholds(thresholds: number[]): void {
    this.alertThresholds = thresholds.sort((a, b) => a - b);
    this.emit('thresholds:updated', { thresholds: this.alertThresholds });
  }

  reset(): void {
    this.currentCost = 0;
    this.agentCosts.clear();
    this.modelCosts.clear();
    this.tickCosts = [];
    this.alerts = [];
    this.startTime = 0;
    this.startTick = 0;
    this.emit('tracker:reset');
  }

  getStatistics(): {
    totalCost: number;
    budget: number;
    budgetUsed: number;
    agentCount: number;
    modelCount: number;
    tickCount: number;
    avgCostPerTick: number;
    avgCostPerAgent: number;
  } {
    const avgCostPerTick = this.tickCosts.length > 0
      ? this.tickCosts.reduce((a, b) => a + b, 0) / this.tickCosts.length
      : 0;

    const totalAgentCost = Array.from(this.agentCosts.values()).reduce((a, b) => a + b, 0);
    const avgCostPerAgent = this.agentCosts.size > 0
      ? totalAgentCost / this.agentCosts.size
      : 0;

    return {
      totalCost: this.currentCost,
      budget: this.budget,
      budgetUsed: this.getBudgetPercentage(),
      agentCount: this.agentCosts.size,
      modelCount: this.modelCosts.size,
      tickCount: this.tickCosts.length,
      avgCostPerTick,
      avgCostPerAgent,
    };
  }
}

let globalTracker: CostTracker | null = null;

export function initCostTracker(budget: number): CostTracker {
  globalTracker = new CostTracker(budget);
  return globalTracker;
}

export function getCostTracker(): CostTracker | null {
  return globalTracker;
}
