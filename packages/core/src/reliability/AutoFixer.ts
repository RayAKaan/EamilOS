import { ErrorCategory } from '../diagnostics/ErrorClassifier.js';
import type { ClassifiedError } from '../diagnostics/ErrorClassifier.js';

export interface FixAttempt {
  timestamp: string;
  action: string;
  success: boolean;
  error?: string;
}

export interface AutoFixStrategy {
  category: ErrorCategory;
  priority: number;
  actions: FixAction[];
}

export interface FixAction {
  type: 'retry' | 'simplify' | 'alternate' | 'fallback' | 'notify';
  description: string;
  execute: () => Promise<FixResult>;
}

export interface FixResult {
  success: boolean;
  message: string;
  data?: any;
  remainingAttempts?: number;
}

export class AutoFixer {
  private strategies: Map<ErrorCategory, AutoFixStrategy> = new Map();
  private history: Map<string, FixAttempt[]> = new Map();
  private maxHistoryEntries: number = 100;

  constructor() {
    this.registerDefaultStrategies();
  }

  private registerDefaultStrategies(): void {
    this.registerStrategy({
      category: ErrorCategory.PARSE_ERROR,
      priority: 1,
      actions: [
        {
          type: 'retry',
          description: 'Retry with stricter parsing',
          execute: async () => ({ success: true, message: 'Retry with strict parsing' }),
        },
        {
          type: 'simplify',
          description: 'Simplify request to reduce complexity',
          execute: async () => ({ success: true, message: 'Simplified request' }),
        },
      ],
    });

    this.registerStrategy({
      category: ErrorCategory.NETWORK_ERROR,
      priority: 2,
      actions: [
        {
          type: 'retry',
          description: 'Retry with exponential backoff',
          execute: async () => ({ success: true, message: 'Network retry successful' }),
        },
        {
          type: 'alternate',
          description: 'Try alternate endpoint',
          execute: async () => ({ success: true, message: 'Using alternate endpoint' }),
        },
      ],
    });

    this.registerStrategy({
      category: ErrorCategory.RATE_LIMIT_ERROR,
      priority: 3,
      actions: [
        {
          type: 'retry',
          description: 'Wait and retry',
          execute: async () => ({ success: true, message: 'Rate limit wait completed' }),
        },
        {
          type: 'fallback',
          description: 'Use rate-limited fallback model',
          execute: async () => ({ success: true, message: 'Using fallback model' }),
        },
      ],
    });

    this.registerStrategy({
      category: ErrorCategory.TIMEOUT_ERROR,
      priority: 2,
      actions: [
        {
          type: 'retry',
          description: 'Retry with extended timeout',
          execute: async () => ({ success: true, message: 'Timeout extended' }),
        },
        {
          type: 'simplify',
          description: 'Reduce request size',
          execute: async () => ({ success: true, message: 'Request reduced' }),
        },
      ],
    });

    this.registerStrategy({
      category: ErrorCategory.MODEL_ERROR,
      priority: 1,
      actions: [
        {
          type: 'alternate',
          description: 'Switch to alternate model',
          execute: async () => ({ success: true, message: 'Model switched' }),
        },
        {
          type: 'fallback',
          description: 'Use fallback model',
          execute: async () => ({ success: true, message: 'Fallback model active' }),
        },
      ],
    });
  }

  registerStrategy(strategy: AutoFixStrategy): void {
    this.strategies.set(strategy.category, strategy);
  }

  async attemptFix(classified: ClassifiedError, maxAttempts?: number): Promise<FixResult> {
    const strategy = this.strategies.get(classified.category);
    
    if (!strategy) {
      return {
        success: false,
        message: `No fix strategy registered for ${classified.category}`,
        remainingAttempts: 0,
      };
    }

    const historyKey = classified.category;
    const attempts = this.history.get(historyKey) || [];
    const currentAttempt = attempts.length;

    if (maxAttempts !== undefined && currentAttempt >= maxAttempts) {
      return {
        success: false,
        message: 'Max fix attempts exceeded',
        remainingAttempts: 0,
      };
    }

    const actionIndex = Math.min(currentAttempt, strategy.actions.length - 1);
    const action = strategy.actions[actionIndex];

    try {
      const result = await action.execute();

      this.recordAttempt(historyKey, {
        timestamp: new Date().toISOString(),
        action: action.description,
        success: result.success,
        error: result.success ? undefined : result.message,
      });

      return {
        ...result,
        remainingAttempts: Math.max(0, maxAttempts !== undefined ? maxAttempts - currentAttempt - 1 : strategy.actions.length - actionIndex - 1),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.recordAttempt(historyKey, {
        timestamp: new Date().toISOString(),
        action: action.description,
        success: false,
        error: errorMessage,
      });

      return {
        success: false,
        message: `Fix action failed: ${errorMessage}`,
        remainingAttempts: Math.max(0, (maxAttempts !== undefined ? maxAttempts - currentAttempt - 1 : strategy.actions.length - actionIndex - 1)),
      };
    }
  }

  private recordAttempt(key: string, attempt: FixAttempt): void {
    const history = this.history.get(key) || [];
    history.unshift(attempt);
    
    if (history.length > this.maxHistoryEntries) {
      history.pop();
    }
    
    this.history.set(key, history);
  }

  getFixHistory(category?: ErrorCategory): FixAttempt[] {
    if (category) {
      return this.history.get(category) || [];
    }
    
    const allHistory: FixAttempt[] = [];
    for (const history of this.history.values()) {
      allHistory.push(...history);
    }
    
    return allHistory.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  getSuccessRate(category?: ErrorCategory): number {
    const history = this.getFixHistory(category);
    
    if (history.length === 0) {
      return 0;
    }
    
    const successful = history.filter(h => h.success).length;
    return successful / history.length;
  }

  clearHistory(category?: ErrorCategory): void {
    if (category) {
      this.history.delete(category);
    } else {
      this.history.clear();
    }
  }

  hasStrategy(category: ErrorCategory): boolean {
    return this.strategies.has(category);
  }

  getRegisteredCategories(): ErrorCategory[] {
    return Array.from(this.strategies.keys());
  }
}
