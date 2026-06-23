import {
  DecisionRequest,
  DecisionResponse,
  DecisionEvent,
  DecisionConfig,
  DEFAULT_DECISION_CONFIG,
  createDecisionRequest,
  shouldAutoApply,
  requiresInteraction,
} from './decision-types.js';
import { EventEmitter } from 'events';
import { ScoredStrategy, PredictionResult } from './prediction-types.js';

export type DecisionHandler = (request: DecisionRequest) => Promise<DecisionResponse>;

export interface DecisionEngineConfig extends DecisionConfig {
  persistenceEnabled: boolean;
}

const DEFAULT_ENGINE_CONFIG: DecisionEngineConfig = {
  ...DEFAULT_DECISION_CONFIG,
  persistenceEnabled: true,
};

export interface PendingDecision {
  request: DecisionRequest;
  resolve: (response: DecisionResponse) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  createdAt: number;
}

export class DecisionEngine extends EventEmitter {
  private config: DecisionEngineConfig;
  private pendingDecisions: Map<string, PendingDecision> = new Map();
  private completedDecisions: Map<string, DecisionResponse> = new Map();
  private handler: DecisionHandler | null = null;
  private sessionsWithDecisions: Map<string, DecisionResponse[]> = new Map();

  constructor(config?: Partial<DecisionEngineConfig>) {
    super();
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
  }

  setHandler(handler: DecisionHandler): void {
    this.handler = handler;
  }

  createRequest(
    sessionId: string,
    nodeId: string,
    type: DecisionRequest['type'],
    question: string,
    options: string[],
    config?: Partial<DecisionConfig>
  ): DecisionRequest {
    return createDecisionRequest(sessionId, nodeId, type, question, options, config);
  }

  createFromPrediction(
    sessionId: string,
    nodeId: string,
    predictionResult: PredictionResult
  ): DecisionRequest {
    const strategies = predictionResult.strategies;
    const strategyOptions = strategies.map(s => s.label);
    const confidenceMap: Record<string, number> = {};
    for (const s of strategies) {
      confidenceMap[s.id] = s.confidence;
    }

    const request = this.createRequest(
      sessionId,
      nodeId,
      'strategy',
      predictionResult.reasoning,
      strategyOptions,
      {}
    );

    request.recommended = predictionResult.recommendedStrategy.label;
    request.confidence = confidenceMap;
    if (request.context) {
      request.context.failureType = predictionResult.signals.failureType;
      request.context.attempt = predictionResult.signals.attempt;
      request.context.model = predictionResult.signals.targetModel;
    }

    return request;
  }

  async request(request: DecisionRequest): Promise<DecisionResponse> {
    this.emit('decision.required', { type: 'decision.required', request, timestamp: Date.now() } as DecisionEvent);

    if (this.config.enableAutoDecision && shouldAutoApply(request)) {
      const autoResponse = this.createAutoResponse(request);
      this.emit('decision.made', { type: 'decision.made', request, response: autoResponse, timestamp: Date.now() } as DecisionEvent);
      return autoResponse;
    }

    if (!requiresInteraction(request)) {
      const autoResponse = this.createTimeoutResponse(request, request.defaultOption);
      this.emit('decision.made', { type: 'decision.made', request, response: autoResponse, timestamp: Date.now() } as DecisionEvent);
      return autoResponse;
    }

    if (!this.handler) {
      throw new Error('No decision handler configured');
    }

    const handler = this.handler;
    const pending: PendingDecision = {
      request,
      resolve: () => {},
      reject: () => {},
      timeoutHandle: null,
      createdAt: Date.now(),
    };

    const promise = new Promise<DecisionResponse>((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;

      const timeoutMs = request.timeoutMs || this.config.defaultTimeoutMs;

      pending.timeoutHandle = setTimeout(() => {
        this.handleTimeout(request.id);
      }, timeoutMs);

      this.pendingDecisions.set(request.id, pending);

      handler(request).then(
        response => {
          this.resolveDecision(request.id, response);
        },
        error => {
          this.rejectDecision(request.id, error);
        }
      );
    });

    return promise;
  }

  async requestWithStrategy(
    sessionId: string,
    nodeId: string,
    strategies: ScoredStrategy[],
    prediction: PredictionResult
  ): Promise<DecisionResponse> {
    const strategyOptions = strategies.map(s => s.label);
    const confidenceMap: Record<string, number> = {};
    for (const s of strategies) {
      confidenceMap[s.id] = s.confidence;
    }

    const request = this.createRequest(
      sessionId,
      nodeId,
      'strategy',
      prediction.reasoning,
      strategyOptions,
      {}
    );

    request.recommended = prediction.recommendedStrategy.label;
    request.confidence = confidenceMap;
    if (request.context) {
      request.context.failureType = prediction.signals.failureType;
      request.context.attempt = prediction.signals.attempt;
      request.context.model = prediction.signals.targetModel;
    }

    return this.request(request);
  }

  private createAutoResponse(request: DecisionRequest): DecisionResponse {
    const selected = request.recommended || request.defaultOption || request.options[0];
    return {
      id: `response_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      requestId: request.id,
      selected,
      source: 'auto',
      timestamp: Date.now(),
    };
  }

  private createTimeoutResponse(request: DecisionRequest, fallback: string): DecisionResponse {
    return {
      id: `response_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      requestId: request.id,
      selected: fallback || request.defaultOption,
      source: 'timeout',
      timestamp: Date.now(),
    };
  }

  private resolveDecision(requestId: string, response: DecisionResponse): void {
    const pending = this.pendingDecisions.get(requestId);
    if (!pending) return;

    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }

    pending.request.status = 'answered';
    this.pendingDecisions.delete(requestId);
    this.completedDecisions.set(requestId, response);

    this.emit('decision.made', {
      type: 'decision.made',
      request: pending.request,
      response,
      timestamp: Date.now(),
    } as DecisionEvent);

    pending.resolve(response);
  }

  private rejectDecision(requestId: string, error: Error): void {
    const pending = this.pendingDecisions.get(requestId);
    if (!pending) return;

    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }

    this.pendingDecisions.delete(requestId);
    pending.reject(error);
  }

  private handleTimeout(requestId: string): void {
    const pending = this.pendingDecisions.get(requestId);
    if (!pending) return;

    const timeoutResponse = this.createTimeoutResponse(pending.request, pending.request.defaultOption);
    pending.request.status = 'timeout';
    this.pendingDecisions.delete(requestId);
    this.completedDecisions.set(requestId, timeoutResponse);

    this.emit('decision.timeout', {
      type: 'decision.timeout',
      request: pending.request,
      response: timeoutResponse,
      timestamp: Date.now(),
    } as DecisionEvent);

    pending.resolve(timeoutResponse);
  }

  getPendingDecision(requestId: string): DecisionRequest | null {
    const pending = this.pendingDecisions.get(requestId);
    return pending?.request || null;
  }

  getCompletedDecision(requestId: string): DecisionResponse | undefined {
    return this.completedDecisions.get(requestId);
  }

  hasPendingDecision(requestId: string): boolean {
    return this.pendingDecisions.has(requestId);
  }

  getActiveDecisionCount(): number {
    return this.pendingDecisions.size;
  }

  cancelDecision(requestId: string): boolean {
    const pending = this.pendingDecisions.get(requestId);
    if (!pending) return false;

    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }

    this.pendingDecisions.delete(requestId);
    pending.request.status = 'cancelled';

    this.emit('decision.cancelled', {
      type: 'decision.cancelled',
      request: pending.request,
      timestamp: Date.now(),
    } as DecisionEvent);

    return true;
  }

  cancelAllDecisions(): number {
    let count = 0;
    for (const requestId of this.pendingDecisions.keys()) {
      if (this.cancelDecision(requestId)) {
        count++;
      }
    }
    return count;
  }

  attachDecisionToSession(sessionId: string, response: DecisionResponse): void {
    const existing = this.sessionsWithDecisions.get(sessionId) || [];
    existing.push(response);
    this.sessionsWithDecisions.set(sessionId, existing);
  }

  getDecisionsForSession(sessionId: string): DecisionResponse[] {
    return this.sessionsWithDecisions.get(sessionId) || [];
  }

  restoreSessionDecisions(sessionId: string, decisions: DecisionResponse[]): void {
    this.sessionsWithDecisions.set(sessionId, decisions);
    for (const decision of decisions) {
      this.completedDecisions.set(decision.requestId, decision);
    }
  }

  clearSessionDecisions(sessionId: string): void {
    this.sessionsWithDecisions.delete(sessionId);
  }

  close(): void {
    this.cancelAllDecisions();
    this.removeAllListeners();
  }
}

let globalDecisionEngine: DecisionEngine | null = null;

export function initDecisionEngine(config?: Partial<DecisionEngineConfig>): DecisionEngine {
  if (globalDecisionEngine) {
    return globalDecisionEngine;
  }
  globalDecisionEngine = new DecisionEngine(config);
  return globalDecisionEngine;
}

export function getDecisionEngine(): DecisionEngine {
  if (!globalDecisionEngine) {
    return initDecisionEngine();
  }
  return globalDecisionEngine;
}