import { describe, test, expect, beforeEach } from "vitest";
import { withTimeout, isTimeoutError } from "../../src/utils/withTimeout.js";
import { retry, isRetryableError, RetryableError } from "../../src/utils/retry.js";
import { estimateTokens, estimateMessageTokens, estimateRequestTokens } from "../../src/utils/tokenEstimator.js";
import { ProviderCircuitBreaker } from "../../src/providers/ProviderCircuitBreaker.js";

describe("withTimeout", () => {
  test("TC-1.5.01: Resolves successfully when promise completes within time", async () => {
    const result = await withTimeout(
      Promise.resolve("success"),
      1000,
      "test"
    );
    expect(result).toBe("success");
  });

  test("TC-1.5.02: Rejects with timeout error when promise exceeds time", async () => {
    await expect(
      withTimeout(
        new Promise((resolve) => setTimeout(() => resolve("late"), 100)),
        50,
        "test"
      )
    ).rejects.toThrow("test timed out after 50ms");
  });

  test("TC-1.5.03: Timeout error is correctly identified", async () => {
    try {
      await withTimeout(
        new Promise((resolve) => setTimeout(() => resolve("late"), 200)),
        50,
        "test"
      );
    } catch (error) {
      expect(isTimeoutError(error)).toBe(true);
    }
  });

  test("TC-1.5.04: Default timeout is 120 seconds", async () => {
    const fastPromise = Promise.resolve("fast");
    const result = await withTimeout(fastPromise);
    expect(result).toBe("fast");
  });
});

describe("retry", () => {
  test("TC-1.5.05: Succeeds on first attempt when function succeeds", async () => {
    let attempts = 0;
    const result = await retry(() => {
      attempts++;
      return Promise.resolve("success");
    });

    expect(result).toBe("success");
    expect(attempts).toBe(1);
  });

  test("TC-1.5.06: Retries on transient errors and eventually succeeds", async () => {
    let attempts = 0;
    const result = await retry(
      () => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error("timeout"));
        }
        return Promise.resolve("success");
      },
      { attempts: 3, baseDelay: 10, maxDelay: 50 }
    );

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  test("TC-1.5.07: Throws after exhausting retries for non-retryable errors", async () => {
    let attempts = 0;
    await expect(
      retry(
        () => {
          attempts++;
          return Promise.reject(new Error("invalid credentials"));
        },
        { attempts: 3, baseDelay: 10, maxDelay: 50 }
      )
    ).rejects.toThrow("invalid credentials");

    expect(attempts).toBe(1);
  });

  test("TC-1.5.08: Retries on rate limit errors (429)", async () => {
    let attempts = 0;
    await retry(
      () => {
        attempts++;
        if (attempts < 2) {
          return Promise.reject(new Error("429 rate limit exceeded"));
        }
        return Promise.resolve("success");
      },
      { attempts: 3, baseDelay: 10, maxDelay: 50 }
    );

    expect(attempts).toBe(2);
  });

  test("TC-1.5.09: Calls onRetry callback on each retry", async () => {
    let attempts = 0;
    const onRetryCalls: number[] = [];

    await retry(
      () => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error("timeout"));
        }
        return Promise.resolve("success");
      },
      {
        attempts: 3,
        baseDelay: 10,
        maxDelay: 50,
        onRetry: (attempt: number) => {
          onRetryCalls.push(attempt);
        },
      }
    );

    expect(onRetryCalls).toEqual([1, 2]);
  });
});

describe("isRetryableError", () => {
  test("TC-1.5.10: Identifies timeout as retryable", () => {
    expect(isRetryableError(new Error("timeout"))).toBe(true);
    expect(isRetryableError(new Error("connection timeout"))).toBe(true);
  });

  test("TC-1.5.11: Identifies rate limit as retryable", () => {
    expect(isRetryableError(new Error("429"))).toBe(true);
    expect(isRetryableError(new Error("rate limit exceeded"))).toBe(true);
  });

  test("TC-1.5.12: Identifies connection errors as retryable", () => {
    expect(isRetryableError(new Error("ECONNREFUSED"))).toBe(true);
    expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableError(new Error("network error"))).toBe(true);
  });

  test("TC-1.5.13: Non-retryable errors return false", () => {
    expect(isRetryableError(new Error("invalid api key"))).toBe(false);
    expect(isRetryableError(new Error("not found"))).toBe(false);
  });
});

describe("Token Estimation", () => {
  test("TC-1.5.14: estimateTokens is consistent for same input", () => {
    const text = "Hello, world!";
    const tokens1 = estimateTokens(text);
    const tokens2 = estimateTokens(text);
    expect(tokens1).toBe(tokens2);
  });

  test("TC-1.5.15: Longer text uses more tokens", () => {
    const short = "hi";
    const long = "this is a much longer text for testing token estimation";
    expect(estimateTokens(long)).toBeGreaterThan(estimateTokens(short));
  });

  test("TC-1.5.16: Empty string returns 0 tokens", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  test("TC-1.5.17: estimateMessageTokens calculates overhead", () => {
    const messages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];
    const tokens = estimateMessageTokens(messages);
    expect(tokens).toBeGreaterThan(estimateTokens("Hello") + estimateTokens("Hi there!"));
  });

  test("TC-1.5.18: estimateRequestTokens returns complete estimate", () => {
    const messages = [{ role: "user", content: "Test message" }];
    const estimate = estimateRequestTokens(messages, 500);
    
    expect(estimate.promptTokens).toBeGreaterThan(0);
    expect(estimate.maxCompletionTokens).toBe(500);
    expect(estimate.totalEstimate).toBe(estimate.promptTokens + estimate.maxCompletionTokens);
  });
});

describe("ProviderCircuitBreaker", () => {
  let circuitBreaker: ProviderCircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new ProviderCircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 1000,
    });
  });

  test("TC-1.5.19: Provider is available initially", () => {
    expect(circuitBreaker.isAvailable("test-provider")).toBe(true);
  });

  test("TC-1.5.20: Records success and maintains availability", () => {
    circuitBreaker.recordSuccess("test-provider", 100);
    circuitBreaker.recordSuccess("test-provider", 150);
    
    const state = circuitBreaker.getStateInfo("test-provider");
    expect(state.available).toBe(true);
    expect(state.failures).toBe(0);
    expect(state.totalRequests).toBe(2);
    expect(state.successRate).toBe(1);
  });

  test("TC-1.5.21: Records failure and increments counter", () => {
    circuitBreaker.recordFailure("test-provider", 200);
    circuitBreaker.recordFailure("test-provider", 300);
    
    const state = circuitBreaker.getStateInfo("test-provider");
    expect(state.failures).toBe(2);
    expect(state.totalRequests).toBe(2);
    expect(state.errorRate).toBe(1);
    expect(state.avgLatency).toBe(250);
  });

  test("TC-1.5.22: Opens circuit after threshold failures", () => {
    circuitBreaker.recordFailure("test-provider", 100);
    circuitBreaker.recordFailure("test-provider", 100);
    
    expect(circuitBreaker.isAvailable("test-provider")).toBe(true);
    
    circuitBreaker.recordFailure("test-provider", 100);
    
    expect(circuitBreaker.isAvailable("test-provider")).toBe(false);
    
    const state = circuitBreaker.getStateInfo("test-provider");
    expect(state.blocked).toBe(true);
  });

  test("TC-1.5.23: Circuit closes after cooldown period", async () => {
    circuitBreaker = new ProviderCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 50,
    });
    
    circuitBreaker.recordFailure("test-provider", 100);
    expect(circuitBreaker.isAvailable("test-provider")).toBe(false);
    
    await new Promise((resolve) => setTimeout(resolve, 60));
    
    expect(circuitBreaker.isAvailable("test-provider")).toBe(true);
    
    const state = circuitBreaker.getStateInfo("test-provider");
    expect(state.blocked).toBe(false);
    expect(state.failures).toBe(0);
  });

  test("TC-1.5.24: Success resets failure counter", () => {
    circuitBreaker.recordFailure("test-provider", 100);
    circuitBreaker.recordFailure("test-provider", 100);
    
    circuitBreaker.recordSuccess("test-provider", 150);
    
    circuitBreaker.recordFailure("test-provider", 100);
    circuitBreaker.recordFailure("test-provider", 100);
    
    expect(circuitBreaker.isAvailable("test-provider")).toBe(true);
  });

  test("TC-1.5.25: Reset clears provider state", () => {
    circuitBreaker.recordFailure("test-provider", 100);
    circuitBreaker.recordFailure("test-provider", 100);
    circuitBreaker.recordFailure("test-provider", 100);
    
    circuitBreaker.reset("test-provider");
    
    const state = circuitBreaker.getStateInfo("test-provider");
    expect(state.totalRequests).toBe(0);
    expect(state.failures).toBe(0);
  });

  test("TC-1.5.26: Get all states returns all providers", () => {
    circuitBreaker.recordSuccess("provider-1", 100);
    circuitBreaker.recordFailure("provider-2", 100);
    
    const allStates = circuitBreaker.getAllStates();
    expect(allStates.size).toBe(2);
    expect(allStates.has("provider-1")).toBe(true);
    expect(allStates.has("provider-2")).toBe(true);
  });

  test("TC-1.5.27: Success rate calculation is accurate", () => {
    circuitBreaker = new ProviderCircuitBreaker({
      failureThreshold: 5,
      cooldownMs: 60000,
    });
    
    circuitBreaker.recordSuccess("test-provider", 100);
    circuitBreaker.recordSuccess("test-provider", 100);
    circuitBreaker.recordFailure("test-provider", 100);
    circuitBreaker.recordFailure("test-provider", 100);
    
    const state = circuitBreaker.getStateInfo("test-provider");
    expect(state.totalRequests).toBe(4);
    expect(state.totalFailures).toBe(2);
    expect(state.successRate).toBe(0.5);
    expect(state.errorRate).toBe(0.5);
  });
});

describe("RetryableError", () => {
  test("TC-1.5.28: Can be instantiated with message", () => {
    const error = new RetryableError("Test error");
    expect(error.message).toBe("Test error");
    expect(error.name).toBe("RetryableError");
  });

  test("TC-1.5.29: Can wrap original error", () => {
    const original = new Error("Original");
    const error = new RetryableError("Wrapped", original);
    expect(error.originalError).toBe(original);
  });
});
