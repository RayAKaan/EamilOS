import { ProviderStatus } from "../providers/types.js";
import { ExecutionResult } from "../execution/ParallelExecutor.js";

export interface EamilOSEvents {
  "system:providers-ready": {
    providers: ProviderStatus[];
    failed: ProviderStatus[];
  };
  "system:execution-start": {
    taskCount: number;
    agentCount: number;
    parallelLimit: number;
    agents: Array<{ id: string; model: string; provider: string }>;
  };
  "system:execution-complete": {
    results: ExecutionResult[];
    totalDurationMs: number;
  };
  "agent:start": {
    agentId: string;
    model: string;
    provider: string;
    source: string;
  };
  "agent:streaming": {
    agentId: string;
    tokenCount: number;
  };
  "agent:complete": {
    agentId: string;
    model: string;
    provider: string;
    tokensUsed: number;
    durationMs: number;
  };
  "agent:error": {
    agentId: string;
    attempt: number;
    maxAttempts: number;
    error: string;
  };
  "task:start": {
    taskId: string;
    parallel: boolean;
  };
  "task:complete": {
    taskId: string;
    durationMs: number;
  };
  "task:failed": {
    taskId: string;
    error: string;
  };
  "provider:auto-fix-start": {
    providerId: string;
    issue: string;
  };
  "provider:auto-fix-success": {
    providerId: string;
    action: string;
  };
  "provider:auto-fix-failed": {
    providerId: string;
    error: string;
  };
  "model:fallback-activated": {
    agentId: string;
    from: string;
    to: string;
    reason: string;
  };
  "model:auto-selected": {
    agentId: string;
    model: string;
    reason: string;
  };
  "provider:request-start": {
    providerId: string;
    model: string;
    tokenEstimate?: number;
  };
  "provider:request-success": {
    providerId: string;
    model: string;
    latencyMs: number;
    tokensUsed: number;
    success: boolean;
  };
  "provider:request-failure": {
    providerId: string;
    model: string;
    latencyMs: number;
    error: string;
    retryable: boolean;
  };
  "provider:circuit-opened": {
    providerId: string;
    reason: string;
  };
  "provider:circuit-closed": {
    providerId: string;
  };
}

type EventHandler<K extends keyof EamilOSEvents> = (data: EamilOSEvents[K]) => void;

export class TypedEventBus {
  private handlers: Map<keyof EamilOSEvents, Set<EventHandler<any>>> = new Map();
  private wildcardHandlers: Set<EventHandler<any>> = new Set();

  on<K extends keyof EamilOSEvents>(event: K, handler: EventHandler<K>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off<K extends keyof EamilOSEvents>(event: K, handler: EventHandler<K>): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  once<K extends keyof EamilOSEvents>(event: K, handler: EventHandler<K>): void {
    const wrapped: EventHandler<K> = (data) => {
      this.off(event, wrapped);
      handler(data);
    };
    this.on(event, wrapped);
  }

  emit<K extends keyof EamilOSEvents>(event: K, data: EamilOSEvents[K]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for '${event as string}':`, error);
        }
      }
    }

    for (const handler of this.wildcardHandlers) {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in wildcard event handler:`, error);
      }
    }
  }

  onAny(handler: EventHandler<any>): void {
    this.wildcardHandlers.add(handler);
  }

  offAny(handler: EventHandler<any>): void {
    this.wildcardHandlers.delete(handler);
  }

  removeAllListeners(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
  }
}

let globalEventBus: TypedEventBus | null = null;

export function getTypedEventBus(): TypedEventBus {
  if (!globalEventBus) {
    globalEventBus = new TypedEventBus();
  }
  return globalEventBus;
}

export function resetTypedEventBus(): void {
  if (globalEventBus) {
    globalEventBus.removeAllListeners();
  }
  globalEventBus = null;
}
