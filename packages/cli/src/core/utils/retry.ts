/**
 * Retry utility with exponential backoff
 * Handles transient errors gracefully
 */

export interface RetryOptions {
  attempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  onRetry?: (attempt: number, error: Error, delay: number) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  attempts: 3,
  baseDelay: 500,
  maxDelay: 5000,
  onRetry: () => {},
};

export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("429") ||
      message.includes("503") ||
      message.includes("502") ||
      message.includes("504") ||
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("network") ||
      message.includes("rate limit")
    );
  }
  return false;
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || i === opts.attempts - 1) {
        throw error;
      }

      const delay = Math.min(
        opts.baseDelay * Math.pow(2, i),
        opts.maxDelay
      );

      opts.onRetry(i + 1, error as Error, delay);

      await sleep(delay);
    }
  }

  throw lastError;
}

export class RetryableError extends Error {
  constructor(message: string, public readonly originalError?: Error) {
    super(message);
    this.name = "RetryableError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a retry wrapper for a specific function
 */
export function withRetry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options?: RetryOptions
): T {
  return ((...args: any[]) => retry(() => fn(...args), options)) as T;
}
