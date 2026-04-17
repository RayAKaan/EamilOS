import { DecisionEngine, getDecisionEngine } from './decision-engine.js';
import { DecisionUI, createDecisionUI } from './decision-ui.js';
import { DecisionRequest, DecisionResponse } from './decision-types.js';
import { PredictionResult } from './prediction-types.js';
import { ExecutionNode } from './graph-types.js';

export type DecisionSourceType = 'user' | 'auto' | 'timeout';

export interface DecisionOrchestratorConfig {
  enableUI: boolean;
  defaultTimeoutMs: number;
  autoApplyHighConfidence: boolean;
}

const DEFAULT_CONFIG: DecisionOrchestratorConfig = {
  enableUI: true,
  defaultTimeoutMs: 30000,
  autoApplyHighConfidence: true,
};

export interface DecisionRequestContext {
  sessionId: string;
  nodeId: string;
  taskId?: string;
  dagId?: string;
  goal: string;
  attempt: number;
  failureHistory?: Array<{
    type: string;
    message: string;
    stage: string;
  }>;
}

export class DecisionOrchestrator {
  private engine: DecisionEngine;
  private ui: DecisionUI | null = null;
  private config: DecisionOrchestratorConfig;
  private pendingDecision: DecisionRequest | null = null;

  constructor(config?: Partial<DecisionOrchestratorConfig>, engine?: DecisionEngine) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.engine = engine || getDecisionEngine();

    if (this.config.enableUI) {
      this.ui = createDecisionUI();
      this.engine.setHandler(async (request) => this.handleDecisionRequest(request));
    }
  }

  private async handleDecisionRequest(request: DecisionRequest): Promise<DecisionResponse> {
    if (!this.ui) {
      throw new Error('No UI handler configured');
    }
    return this.ui.prompt(request);
  }

  async requestStrategyDecision(
    context: DecisionRequestContext,
    prediction: PredictionResult,
    currentNode?: ExecutionNode
  ): Promise<DecisionResponse> {
    const strategies = prediction.strategies;
    const strategyOptions = strategies.map(s => s.label);
    const confidenceMap: Record<string, number> = {};
    for (const s of strategies) {
      confidenceMap[s.id] = s.confidence;
    }

    const request = this.engine.createRequest(
      context.sessionId,
      context.nodeId,
      'strategy',
      prediction.reasoning,
      strategyOptions,
      {}
    );

    request.recommended = prediction.recommendedStrategy.label;
    request.confidence = confidenceMap;
    if (request.context) {
      request.context.failureType = prediction.signals.failureType;
      request.context.attempt = context.attempt;
      request.context.model = prediction.signals.targetModel;
      request.context.goal = context.goal;
      request.context.previousErrors = context.failureHistory?.map((fh) => fh.message);
    }

    this.pendingDecision = request;

    if (currentNode) {
      this.updateGraphNodeWithDecision(currentNode, request);
    }

    return this.engine.request(request);
  }

  private updateGraphNodeWithDecision(node: ExecutionNode, request: DecisionRequest): void {
    node.decision = {
      question: request.question,
      options: request.options,
      recommended: request.recommended,
      status: request.status,
    };
  }

  applyDecisionToNode(node: ExecutionNode, response: DecisionResponse): void {
    if (node.decision) {
      node.decision.selected = response.selected;
      node.decision.status = 'answered';
      node.decision.source = response.source;
    }
    this.pendingDecision = null;
  }

  async waitForDecision(requestId: string): Promise<DecisionResponse | null> {
    while (this.engine.hasPendingDecision(requestId)) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return this.engine.getCompletedDecision(requestId) || null;
  }

  cancelDecision(requestId: string): boolean {
    return this.engine.cancelDecision(requestId);
  }

  cancelAllDecisions(): number {
    return this.engine.cancelAllDecisions();
  }

  getActiveDecisionCount(): number {
    return this.engine.getActiveDecisionCount();
  }

  hasPendingDecision(): boolean {
    return this.pendingDecision !== null;
  }

  getCurrentDecision(): DecisionRequest | null {
    return this.pendingDecision;
  }

  close(): void {
    this.cancelAllDecisions();
    this.ui?.close();
    this.engine.close();
  }
}

export function createDecisionOrchestrator(config?: Partial<DecisionOrchestratorConfig>): DecisionOrchestrator {
  return new DecisionOrchestrator(config);
}

let globalOrchestrator: DecisionOrchestrator | null = null;

export function initDecisionOrchestrator(config?: Partial<DecisionOrchestratorConfig>): DecisionOrchestrator {
  if (globalOrchestrator) {
    return globalOrchestrator;
  }
  globalOrchestrator = new DecisionOrchestrator(config);
  return globalOrchestrator;
}

export function getDecisionOrchestrator(): DecisionOrchestrator {
  if (!globalOrchestrator) {
    return initDecisionOrchestrator();
  }
  return globalOrchestrator;
}