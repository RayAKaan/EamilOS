import type { JevProvider, LayaModelAdapter, LayaRequest } from '../types.js';
import type {
  IntelligenceCapabilities,
  IntelligenceHealth,
  IntelligenceProvider,
  IntelligenceRequest,
  IntelligenceResponse,
} from '../IntelligenceRuntimeTypes.js';

export class LegacyJevProviderAdapter implements IntelligenceProvider {
  readonly id: string;
  constructor(private readonly provider: JevProvider, id = provider.id === 'deterministic' ? 'jev' : provider.id) { this.id = id; }

  capabilities(): IntelligenceCapabilities {
    return {
      strategicDecision: true,
      taskDecision: true,
      recoveryDecision: true,
      planning: false,
      validationAssessment: true,
      agentSelection: true,
      parallelization: true,
      local: false,
      remote: true,
      streaming: false,
    };
  }

  async initialize(): Promise<void> {}
  async health(): Promise<IntelligenceHealth> {
    const started = Date.now();
    const health = await this.provider.health();
    return {
      providerId: this.id,
      status: health.healthy ? 'READY' : 'UNAVAILABLE',
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      error: health.error,
      capabilities: this.capabilities(),
    };
  }

  async evaluate(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    const result = await this.provider.decide(request.context as Parameters<JevProvider['decide']>[0]);
    return {
      requestId: request.requestId,
      providerId: this.id,
      model: result.model,
      status: 'SUCCESS',
      result: result.decision,
      confidence: result.decision.confidence,
      latencyMs: result.latencyMs,
      usage: result.usage,
      contextVersion: request.contextVersion,
      contextHash: request.contextHash,
    };
  }

  async shutdown(): Promise<void> {}
}

export class LegacyLayaProviderAdapter implements IntelligenceProvider {
  readonly id: string;
  constructor(private readonly provider: LayaModelAdapter, id = provider.id) { this.id = id; }

  capabilities(): IntelligenceCapabilities {
    return {
      strategicDecision: false,
      taskDecision: false,
      recoveryDecision: false,
      planning: true,
      validationAssessment: false,
      agentSelection: false,
      parallelization: false,
      local: true,
      remote: false,
      streaming: false,
    };
  }

  async initialize(): Promise<void> { await this.provider.load(); }
  async health(): Promise<IntelligenceHealth> {
    const started = Date.now();
    const health = await this.provider.health();
    return {
      providerId: this.id,
      status: health.healthy ? 'READY' : 'NOT_CONFIGURED',
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      error: health.error,
      capabilities: this.capabilities(),
    };
  }

  async evaluate(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    if (request.type !== 'PLANNING') {
      return {
        requestId: request.requestId,
        providerId: this.id,
        status: 'REJECTED',
        latencyMs: 0,
        contextVersion: request.contextVersion,
        contextHash: request.contextHash,
        error: { code: 'UNSUPPORTED_REQUEST', message: 'Legacy Laya adapter only supports planning until Phase 2C.', retryable: false },
      };
    }
    const started = Date.now();
    const plan = await this.provider.generate(request.context as LayaRequest);
    return {
      requestId: request.requestId,
      providerId: this.id,
      status: 'SUCCESS',
      result: plan,
      latencyMs: Date.now() - started,
      contextVersion: request.contextVersion,
      contextHash: request.contextHash,
    };
  }

  async shutdown(): Promise<void> { await this.provider.unload(); }
}
