export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterEnabled: boolean;
  retryableCategories?: string[];
}

export interface RetryState {
  attemptNumber: number;
  totalAttempts: number;
  lastError?: string;
  nextRetryAt?: string;
  isComplete: boolean;
  success: boolean;
}

export class RetryStrategy {
  private config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    this.config = {
      maxRetries: config?.maxRetries ?? 3,
      baseDelayMs: config?.baseDelayMs ?? 1000,
      maxDelayMs: config?.maxDelayMs ?? 30000,
      backoffMultiplier: config?.backoffMultiplier ?? 2,
      jitterEnabled: config?.jitterEnabled ?? true,
      retryableCategories: config?.retryableCategories,
    };
  }

  shouldRetry(state: RetryState, isRetryable: boolean): boolean {
    if (state.isComplete || state.success) {
      return false;
    }

    if (state.attemptNumber >= this.config.maxRetries) {
      return false;
    }

    return isRetryable;
  }

  calculateDelay(attemptNumber: number): number {
    const exponentialDelay = this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, attemptNumber);
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);
    
    if (this.config.jitterEnabled) {
      const jitter = Math.random() * 0.3 * cappedDelay;
      return Math.round(cappedDelay + jitter);
    }
    
    return cappedDelay;
  }

  createRetryState(): RetryState {
    return {
      attemptNumber: 0,
      totalAttempts: 0,
      isComplete: false,
      success: false,
    };
  }

  recordAttempt(state: RetryState, error?: Error | string): RetryState {
    const nextAttempt = state.attemptNumber + 1;
    const isComplete = nextAttempt >= this.config.maxRetries;
    
    return {
      attemptNumber: nextAttempt,
      totalAttempts: state.totalAttempts + 1,
      lastError: error instanceof Error ? error.message : String(error),
      nextRetryAt: !isComplete ? new Date(Date.now() + this.calculateDelay(nextAttempt)).toISOString() : undefined,
      isComplete,
      success: false,
    };
  }

  recordSuccess(state: RetryState): RetryState {
    return {
      ...state,
      isComplete: true,
      success: true,
      nextRetryAt: undefined,
    };
  }

  getConfig(): RetryConfig {
    return { ...this.config };
  }

  getDelayForAttempt(attemptNumber: number): number {
    return this.calculateDelay(attemptNumber);
  }

  isCategoryRetryable(category: string): boolean {
    if (!this.config.retryableCategories || this.config.retryableCategories.length === 0) {
      return true;
    }
    
    return this.config.retryableCategories.includes(category);
  }

  withConfig(config: Partial<RetryConfig>): RetryStrategy {
    return new RetryStrategy({
      ...this.config,
      ...config,
    });
  }
}
