import { randomUUID } from 'node:crypto';
import { ContextHasher } from './ContextHasher.js';
import { ContextSanitizer } from './ContextSanitizer.js';
import { IntelligenceLifecycleManager } from './IntelligenceLifecycleManager.js';
import { IntelligenceRouter } from './IntelligenceRouter.js';
import type {
  IntelligenceEventSink,
  IntelligenceHealth,
  IntelligenceRequest,
  IntelligenceResponse,
  IntelligenceResponseStatus,
  IntelligenceRoute,
  IntelligenceRuntime as IntelligenceRuntimeContract,
  IntelligenceRuntimeHealth,
} from './IntelligenceRuntimeTypes.js';
import { IntelligenceProviderRegistry } from './ProviderRegistry.js';

export class IntelligenceRuntime implements IntelligenceRuntimeContract {
  constructor(
    private readonly registry: IntelligenceProviderRegistry,
    private readonly router = new IntelligenceRouter(registry),
    private readonly lifecycle = new IntelligenceLifecycleManager(registry),
    private readonly sanitizer = new ContextSanitizer(),
    private readonly events?: IntelligenceEventSink,
  ) {}

  async initialize(): Promise<void> {
    await this.lifecycle.initialize();
  }

  async route(request: IntelligenceRequest): Promise<IntelligenceRoute> {
    return this.router.route(request);
  }

  async request<TContext = unknown, TResult = unknown>(
    request: IntelligenceRequest<TContext>,
  ): Promise<IntelligenceResponse<TResult>> {
    const context = this.sanitizer.sanitize(request.context);
    const contextHash = request.contextHash || ContextHasher.hash(context);
    const normalized: IntelligenceRequest = {
      ...request,
      context,
      contextHash,
      requestId: request.requestId || randomUUID(),
    };

    await this.emit('intelligence.requested', normalized.requestId, normalized.missionId, normalized.contextVersion, normalized.contextHash, undefined, { type: normalized.type });

    const route = await this.router.route(normalized);
    if (!route.selectedProviderId) {
      const response = this.failure(normalized, 'UNAVAILABLE', {
        code: 'NO_PROVIDER',
        message: route.reason,
        retryable: false,
      });
      await this.emit('intelligence.failed', normalized.requestId, normalized.missionId, normalized.contextVersion, normalized.contextHash, undefined, { reason: route.reason });
      return response as IntelligenceResponse<TResult>;
    }

    const provider = this.registry.get(route.selectedProviderId);
    if (!provider) {
      return this.failure(normalized, 'UNAVAILABLE', {
        code: 'PROVIDER_NOT_FOUND',
        message: `Provider ${route.selectedProviderId} disappeared during routing.`,
        retryable: true,
      }) as IntelligenceResponse<TResult>;
    }

    await this.emit('intelligence.started', normalized.requestId, normalized.missionId, normalized.contextVersion, normalized.contextHash, provider.id);

    const started = Date.now();
    try {
      const response = await provider.evaluate(normalized);
      const result: IntelligenceResponse<TResult> = {
        ...response,
        requestId: normalized.requestId,
        providerId: provider.id,
        latencyMs: response.latencyMs || Date.now() - started,
        contextVersion: normalized.contextVersion,
        contextHash: normalized.contextHash,
      };
      const eventType = result.status === 'SUCCESS' ? 'intelligence.completed' : result.status === 'DEGRADED' ? 'intelligence.degraded' : 'intelligence.failed';
      await this.emit(eventType, normalized.requestId, normalized.missionId, normalized.contextVersion, normalized.contextHash, provider.id, { status: result.status });
      return result;
    } catch (error) {
      const response = this.failure(normalized, 'FAILED' as IntelligenceResponseStatus, {
        code: 'PROVIDER_ERROR',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
      await this.emit('intelligence.failed', normalized.requestId, normalized.missionId, normalized.contextVersion, normalized.contextHash, provider.id, { error: response.error?.message });
      return response as IntelligenceResponse<TResult>;
    }
  }

  async health(): Promise<IntelligenceRuntimeHealth> {
    const providers: IntelligenceHealth[] = await this.lifecycle.health();
    const hasReady = providers.some(provider => provider.status === 'READY' || provider.status === 'DEGRADED');
    return {
      status: hasReady ? (providers.some(provider => provider.status === 'READY') ? 'READY' : 'DEGRADED') : 'NOT_CONFIGURED',
      providers,
      checkedAt: new Date().toISOString(),
    };
  }

  async shutdown(): Promise<void> {
    await this.lifecycle.shutdown();
  }

  private failure(
    request: IntelligenceRequest,
    status: IntelligenceResponseStatus,
    error: NonNullable<IntelligenceResponse['error']>,
  ): IntelligenceResponse {
    return {
      requestId: request.requestId,
      providerId: 'router',
      status,
      latencyMs: 0,
      contextVersion: request.contextVersion,
      contextHash: request.contextHash,
      error,
    };
  }

  private async emit(
    type: Parameters<NonNullable<IntelligenceEventSink['emit']>>[0]['type'],
    requestId: string,
    missionId: string,
    contextVersion: number,
    contextHash: string,
    providerId?: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.events) return;
    await this.events.emit({
      eventId: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      missionId,
      requestId,
      providerId,
      contextVersion,
      contextHash,
      data,
    });
  }
}
