/**
 * Circuit Breaker for Provider Resilience
 * Automatically blocks providers that are failing repeatedly
 */

export interface CircuitState {
  failures: number;
  blockedUntil: number | null;
  lastFailure: number | null;
  lastSuccess: number | null;
  totalRequests: number;
  totalFailures: number;
  totalLatency: number;
}

export class ProviderCircuitBreaker {
  private states: Map<string, CircuitState> = new Map();
  private failureThreshold: number;
  private cooldownMs: number;
  private maxMetricsAge: number;

  constructor(
    options: {
      failureThreshold?: number;
      cooldownMs?: number;
      maxMetricsAge?: number;
    } = {}
  ) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 60000;
    this.maxMetricsAge = options.maxMetricsAge ?? 3600000;
  }

  private getState(providerId: string): CircuitState {
    if (!this.states.has(providerId)) {
      this.states.set(providerId, {
        failures: 0,
        blockedUntil: null,
        lastFailure: null,
        lastSuccess: null,
        totalRequests: 0,
        totalFailures: 0,
        totalLatency: 0,
      });
    }
    return this.states.get(providerId)!;
  }

  isAvailable(providerId: string): boolean {
    const state = this.getState(providerId);

    if (state.blockedUntil === null) {
      return true;
    }

    if (Date.now() > state.blockedUntil) {
      state.blockedUntil = null;
      state.failures = 0;
      return true;
    }

    return false;
  }

  recordSuccess(providerId: string, latencyMs: number = 0): void {
    const state = this.getState(providerId);
    state.failures = 0;
    state.lastSuccess = Date.now();
    state.totalRequests++;
    if (latencyMs > 0) {
      state.totalLatency += latencyMs;
    }
  }

  recordFailure(providerId: string, latencyMs: number = 0): void {
    const state = this.getState(providerId);
    state.failures++;
    state.lastFailure = Date.now();
    state.totalRequests++;
    state.totalFailures++;
    if (latencyMs > 0) {
      state.totalLatency += latencyMs;
    }

    if (state.failures >= this.failureThreshold) {
      state.blockedUntil = Date.now() + this.cooldownMs;
    }
  }

  getStateInfo(providerId: string): {
    available: boolean;
    failures: number;
    totalFailures: number;
    blocked: boolean;
    blockedUntil: number | null;
    lastFailure: number | null;
    lastSuccess: number | null;
    successRate: number;
    errorRate: number;
    avgLatency: number;
    totalRequests: number;
  } {
    const state = this.getState(providerId);
    const available = this.isAvailable(providerId);
    const successRate = state.totalRequests > 0
      ? (state.totalRequests - state.totalFailures) / state.totalRequests
      : 1;
    const errorRate = state.totalRequests > 0
      ? state.totalFailures / state.totalRequests
      : 0;
    const avgLatency = state.totalRequests > 0
      ? state.totalLatency / state.totalRequests
      : 0;

    return {
      available,
      failures: state.failures,
      totalFailures: state.totalFailures,
      blocked: state.blockedUntil !== null && Date.now() <= state.blockedUntil,
      blockedUntil: state.blockedUntil,
      lastFailure: state.lastFailure,
      lastSuccess: state.lastSuccess,
      successRate,
      errorRate,
      avgLatency,
      totalRequests: state.totalRequests,
    };
  }

  reset(providerId: string): void {
    this.states.delete(providerId);
  }

  resetAll(): void {
    this.states.clear();
  }

  getAllStates(): Map<string, ReturnType<typeof this.getStateInfo>> {
    const result = new Map<string, ReturnType<typeof this.getStateInfo>>();
    for (const providerId of this.states.keys()) {
      result.set(providerId, this.getStateInfo(providerId));
    }
    return result;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [providerId, state] of this.states.entries()) {
      const lastActivity = state.lastFailure || state.lastSuccess;
      if (lastActivity && (now - lastActivity) > this.maxMetricsAge) {
        this.states.delete(providerId);
      }
    }
  }
}

export const circuitBreaker = new ProviderCircuitBreaker();
