import { pearsonCorrelation } from './statistics.js';
import type { ExecutionRecord, TunableParameters, ParameterBounds, TuningObservation, TuningState } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

export interface AutoTunerConfig {
  dampingFactor: number;
  minObservations: number;
  maxObservations: number;
  convergenceThreshold: number;
  storagePath: string;
}

export const DEFAULT_AUTO_TUNER_CONFIG: AutoTunerConfig = {
  dampingFactor: 0.5,
  minObservations: 5,
  maxObservations: 100,
  convergenceThreshold: 0.01,
  storagePath: '.eamilos/learning',
};

export const DEFAULT_PARAMETERS: TunableParameters = {
  agentTimeoutMs: 30000,
  tickIntervalMs: 100,
  heartbeatIntervalMs: 10000,
  maxRetriesPerAgent: 3,
  retryBackoffMultiplier: 1.5,
  maxParallelInferences: 4,
  maxParallelAgents: 8,
  contextWindowUtilization: 0.7,
  checkpointIntervalTicks: 10,
};

export class AutoTuner {
  private config: AutoTunerConfig;
  private params: TunableParameters;
  private bounds: Map<keyof TunableParameters, ParameterBounds> = new Map();
  private observationWindow: TuningObservation[] = [];
  private tuningHistory: TuningEvent[] = [];

  constructor(config: Partial<AutoTunerConfig> = {}) {
    this.config = { ...DEFAULT_AUTO_TUNER_CONFIG, ...config };
    this.params = { ...DEFAULT_PARAMETERS };
    this.initBounds();
    this.loadState();
  }

  private initBounds(): void {
    this.bounds.set('agentTimeoutMs', {
      min: 5000,
      max: 120000,
      stepSize: 5000,
      currentValue: this.params.agentTimeoutMs,
      direction: 'hold',
      confidenceInDirection: 0,
    });

    this.bounds.set('maxRetriesPerAgent', {
      min: 1,
      max: 10,
      stepSize: 1,
      currentValue: this.params.maxRetriesPerAgent,
      direction: 'hold',
      confidenceInDirection: 0,
    });

    this.bounds.set('maxParallelInferences', {
      min: 1,
      max: 16,
      stepSize: 1,
      currentValue: this.params.maxParallelInferences,
      direction: 'hold',
      confidenceInDirection: 0,
    });

    this.bounds.set('maxParallelAgents', {
      min: 1,
      max: 16,
      stepSize: 1,
      currentValue: this.params.maxParallelAgents,
      direction: 'hold',
      confidenceInDirection: 0,
    });

    this.bounds.set('contextWindowUtilization', {
      min: 0.3,
      max: 0.95,
      stepSize: 0.05,
      currentValue: this.params.contextWindowUtilization,
      direction: 'hold',
      confidenceInDirection: 0,
    });

    this.bounds.set('checkpointIntervalTicks', {
      min: 3,
      max: 50,
      stepSize: 2,
      currentValue: this.params.checkpointIntervalTicks,
      direction: 'hold',
      confidenceInDirection: 0,
    });

    this.bounds.set('tickIntervalMs', {
      min: 50,
      max: 500,
      stepSize: 50,
      currentValue: this.params.tickIntervalMs,
      direction: 'hold',
      confidenceInDirection: 0,
    });

    this.bounds.set('heartbeatIntervalMs', {
      min: 1000,
      max: 60000,
      stepSize: 1000,
      currentValue: this.params.heartbeatIntervalMs,
      direction: 'hold',
      confidenceInDirection: 0,
    });

    this.bounds.set('retryBackoffMultiplier', {
      min: 1.1,
      max: 4.0,
      stepSize: 0.1,
      currentValue: this.params.retryBackoffMultiplier,
      direction: 'hold',
      confidenceInDirection: 0,
    });
  }

  recordObservation(record: ExecutionRecord): void {
    const observation: TuningObservation = {
      params: { ...this.params },
      success: record.success,
      latencyMs: record.totalLatencyMs,
      retries: record.retryCount,
      cost: record.totalCostUSD,
      timeoutCount: record.errors.filter(e => e.errorType === 'timeout').length,
      timestamp: Date.now(),
    };

    this.observationWindow.push(observation);

    if (this.observationWindow.length > this.config.maxObservations) {
      this.observationWindow.shift();
    }

    if (this.observationWindow.length >= this.config.minObservations) {
      this.tune();
    }

    this.saveState();
  }

  private tune(): void {
    const recent = this.observationWindow.slice(-20);

    this.tuneTimeout(recent);
    this.tuneRetries(recent);
    this.tuneParallelism(recent);
    this.tuneContextWindow(recent);

    this.params = {
      agentTimeoutMs: this.bounds.get('agentTimeoutMs')!.currentValue,
      tickIntervalMs: this.bounds.get('tickIntervalMs')!.currentValue,
      heartbeatIntervalMs: this.bounds.get('heartbeatIntervalMs')!.currentValue,
      maxRetriesPerAgent: this.bounds.get('maxRetriesPerAgent')!.currentValue,
      retryBackoffMultiplier: this.bounds.get('retryBackoffMultiplier')!.currentValue,
      maxParallelInferences: this.bounds.get('maxParallelInferences')!.currentValue,
      maxParallelAgents: this.bounds.get('maxParallelAgents')!.currentValue,
      contextWindowUtilization: this.bounds.get('contextWindowUtilization')!.currentValue,
      checkpointIntervalTicks: this.bounds.get('checkpointIntervalTicks')!.currentValue,
    };
  }

  private tuneTimeout(recent: TuningObservation[]): void {
    const timeoutFailures = recent.filter(o => o.timeoutCount > 0).length / recent.length;
    const bound = this.bounds.get('agentTimeoutMs')!;

    if (timeoutFailures > 0.3) {
      this.adjustParam('agentTimeoutMs', 'increase', `${(timeoutFailures * 100).toFixed(0)}% timeout rate`);
    } else if (timeoutFailures === 0 && bound.currentValue > bound.min + bound.stepSize) {
      this.adjustParam('agentTimeoutMs', 'decrease', 'No timeouts observed');
    }
  }

  private tuneRetries(recent: TuningObservation[]): void {
    const avgRetries = recent.reduce((sum, o) => sum + o.retries, 0) / recent.length;
    const bound = this.bounds.get('maxRetriesPerAgent')!;

    if (avgRetries > bound.currentValue * 0.8) {
      this.adjustParam('maxRetriesPerAgent', 'increase', `Avg retries ${avgRetries.toFixed(1)} near limit`);
    } else if (avgRetries < 0.5 && bound.currentValue > bound.min) {
      this.adjustParam('maxRetriesPerAgent', 'decrease', 'Very few retries needed');
    }
  }

  private tuneParallelism(recent: TuningObservation[]): void {
    const correlation = this.correlateWithSuccess('maxParallelInferences', recent);

    if (correlation > 0.3) {
      this.adjustParam('maxParallelInferences', 'increase', `Positive correlation with success (r=${correlation.toFixed(2)})`);
    } else if (correlation < -0.3) {
      this.adjustParam('maxParallelInferences', 'decrease', `Negative correlation with success (r=${correlation.toFixed(2)})`);
    }
  }

  private tuneContextWindow(recent: TuningObservation[]): void {
    const successRate = recent.filter(o => o.success).length / recent.length;
    const avgLatency = recent.reduce((sum, o) => sum + o.latencyMs, 0) / recent.length;
    const bound = this.bounds.get('contextWindowUtilization')!;

    if (successRate > 0.9 && avgLatency < 30000 && bound.currentValue < bound.max) {
      this.adjustParam('contextWindowUtilization', 'increase', 'High success rate, low latency - can use more context');
    } else if (successRate < 0.7 && bound.currentValue > bound.min) {
      this.adjustParam('contextWindowUtilization', 'decrease', 'Lower success rate - reducing complexity');
    }
  }

  private adjustParam(param: keyof TunableParameters, direction: 'increase' | 'decrease', reason: string): void {
    const bound = this.bounds.get(param)!;
    if (bound.direction === direction && bound.confidenceInDirection > 3) {
      return;
    }

    let newValue: number;
    const step = bound.stepSize * this.config.dampingFactor;

    if (direction === 'increase') {
      newValue = Math.min(bound.max, bound.currentValue + step);
    } else {
      newValue = Math.max(bound.min, bound.currentValue - step);
    }

    newValue = this.snapToStep(newValue, bound.stepSize, bound.min);

    if (Math.abs(newValue - bound.currentValue) < this.config.convergenceThreshold) {
      return;
    }

    if (newValue !== bound.currentValue) {
      const oldValue = bound.currentValue;
      bound.currentValue = newValue;
      bound.direction = direction;
      bound.confidenceInDirection++;

      this.tuningHistory.push({
        param,
        oldValue,
        newValue,
        direction,
        reason,
        timestamp: Date.now(),
      });

      if (direction !== bound.direction) {
        bound.confidenceInDirection = 0;
        bound.direction = 'hold';
      }
    }
  }

  private snapToStep(value: number, step: number, min: number): number {
    if (step === 0) return value;
    return Math.round((value - min) / step) * step + min;
  }

  private correlateWithSuccess(param: keyof TunableParameters, observations: TuningObservation[]): number {
    const values = observations.map(o => (o.params[param] as number) ?? 0);
    const successes = observations.map(o => o.success ? 1 : 0);

    const result = pearsonCorrelation(values, successes);
    return result.correlation;
  }

  adjustParameter(param: keyof TunableParameters, multiplier: number): void {
    const bound = this.bounds.get(param);
    if (!bound) return;

    const newValue = this.snapToStep(
      bound.currentValue * multiplier,
      bound.stepSize,
      bound.min
    );

    if (newValue !== bound.currentValue && newValue >= bound.min && newValue <= bound.max) {
      const oldValue = bound.currentValue;
      bound.currentValue = newValue;
      bound.direction = multiplier > 1 ? 'increase' : 'decrease';
      bound.confidenceInDirection++;

      this.tuningHistory.push({
        param,
        oldValue,
        newValue,
        direction: bound.direction,
        reason: `Manual adjustment (×${multiplier})`,
        timestamp: Date.now(),
      });

      this.saveState();
    }
  }

  getParams(): TunableParameters {
    return { ...this.params };
  }

  getState(): TuningState {
    const state: Record<string, unknown> = {};

    for (const [param, bound] of this.bounds) {
      const defaultValue = (DEFAULT_PARAMETERS as unknown as Record<string, number>)[param];
      const deviation = defaultValue !== 0
        ? ((bound.currentValue - defaultValue) / defaultValue * 100).toFixed(1) + '%'
        : '0%';

      state[param] = {
        current: bound.currentValue,
        default: defaultValue,
        min: bound.min,
        max: bound.max,
        direction: bound.direction,
        deviation,
      };
    }

    return state as unknown as TuningState;
  }

  getHistory(limit: number = 50): TuningEvent[] {
    return this.tuningHistory.slice(-limit);
  }

  resetParam(param: keyof TunableParameters): void {
    const bound = this.bounds.get(param);
    if (!bound) return;

    const defaultValue = (DEFAULT_PARAMETERS as unknown as Record<string, number>)[param];
    bound.currentValue = defaultValue;
    bound.direction = 'hold';
    bound.confidenceInDirection = 0;

    this.tuningHistory.push({
      param,
      oldValue: bound.currentValue,
      newValue: defaultValue,
      direction: 'hold',
      reason: 'Parameter reset to default',
      timestamp: Date.now(),
    });

    this.saveState();
  }

  resetAll(): void {
    for (const param of this.bounds.keys()) {
      this.resetParam(param);
    }
  }

  getConvergenceStatus(): {
    converged: boolean;
    paramsConverged: string[];
    paramsTuning: string[];
  } {
    const paramsConverged: string[] = [];
    const paramsTuning: string[] = [];

    for (const [param, bound] of this.bounds) {
      if (bound.direction === 'hold' || bound.confidenceInDirection === 0) {
        paramsConverged.push(param);
      } else {
        paramsTuning.push(`${param} (${bound.direction}, conf: ${bound.confidenceInDirection})`);
      }
    }

    return {
      converged: paramsTuning.length === 0,
      paramsConverged,
      paramsTuning,
    };
  }

  private loadState(): void {
    try {
      const statePath = path.join(this.config.storagePath, 'tuning_state.json');
      if (fs.existsSync(statePath)) {
        const data = fs.readFileSync(statePath, 'utf-8');
        const state = JSON.parse(data);

        if (state.params) {
          for (const [param, value] of Object.entries(state.params)) {
            const bound = this.bounds.get(param as keyof TunableParameters);
            if (bound && typeof value === 'object') {
              bound.currentValue = (value as Record<string, number>).current ?? bound.currentValue;
              bound.direction = ((value as Record<string, string>).direction as 'increase' | 'decrease' | 'hold') ?? 'hold';
              bound.confidenceInDirection = (value as Record<string, number>).confidence ?? 0;
            }
          }
        }

        if (state.observations && Array.isArray(state.observations)) {
          this.observationWindow = state.observations.slice(-this.config.maxObservations);
        }

        if (state.history && Array.isArray(state.history)) {
          this.tuningHistory = state.history;
        }
      }
    } catch {
      // Start with defaults
    }
  }

  private saveState(): void {
    try {
      const statePath = path.join(this.config.storagePath, 'tuning_state.json');
      const dir = path.dirname(statePath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const state = {
        params: Object.fromEntries(this.bounds.entries()),
        observations: this.observationWindow,
        history: this.tuningHistory.slice(-100),
        timestamp: Date.now(),
      };

      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch {
      // Silently fail
    }
  }
}

interface TuningEvent {
  param: keyof TunableParameters;
  oldValue: number;
  newValue: number;
  direction: 'increase' | 'decrease' | 'hold';
  reason: string;
  timestamp: number;
}
