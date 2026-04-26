import { EventEmitter } from 'events';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  expectedException?: (error: Error) => boolean;
}

export class CircuitBreaker extends EventEmitter {
  private failureCount = 0;
  private lastFailureTime?: number;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private nextAttempt = 0;

  constructor(private config: CircuitBreakerConfig) {
    super();
    this.config = {
      failureThreshold: config.failureThreshold ?? 3,
      recoveryTimeout: config.recoveryTimeout ?? 60000,
      expectedException: config.expectedException
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        const error = new Error('Circuit breaker is OPEN');
        this.emit('rejected', { state: this.state, error });
        throw error;
      }
      this.transitionTo('HALF_OPEN');
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as Error);
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    const previousState = this.state;
    this.transitionTo('CLOSED');
    this.emit('success', { from: previousState });
  }

  private onFailure(error: Error): void {
    if (this.config.expectedException && !this.config.expectedException(error)) {
      return;
    }

    this.failureCount++;
    this.lastFailureTime = Date.now();

    this.emit('failure', {
      error: error.message,
      failureCount: this.failureCount,
      threshold: this.config.failureThreshold
    });

    if (this.failureCount >= this.config.failureThreshold) {
      this.transitionTo('OPEN');
      this.nextAttempt = Date.now() + this.config.recoveryTimeout;
    }
  }

  private transitionTo(state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'): void {
    const previousState = this.state;
    this.state = state;
    this.emit('state_change', { from: previousState, to: state });
  }

  getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.state;
  }

  getMetrics() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt,
      threshold: this.config.failureThreshold
    };
  }

  reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = undefined;
    this.transitionTo('CLOSED');
  }
}