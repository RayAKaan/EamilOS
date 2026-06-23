import { FailureType } from './stateful-types.js';

export type DecisionType = 'strategy' | 'ambiguity' | 'risk' | 'override';

export type DecisionStatus = 'pending' | 'answered' | 'timeout' | 'cancelled';

export type DecisionSource = 'user' | 'auto' | 'timeout';

export interface DecisionRequest {
  id: string;
  nodeId: string;
  sessionId: string;

  type: DecisionType;

  question: string;
  options: string[];

  recommended?: string;
  confidence?: Record<string, number>;

  timeoutMs: number;
  defaultOption: string;

  context?: {
    failureType?: FailureType;
    attempt?: number;
    model?: string;
    goal?: string;
    previousErrors?: string[];
  };

  createdAt: number;
  status: DecisionStatus;
}

export interface DecisionResponse {
  id: string;
  requestId: string;
  selected: string;
  source: DecisionSource;
  timestamp: number;
}

export interface DecisionContext {
  sessionId: string;
  nodeId: string;
  taskId?: string;
  dagId?: string;
  currentGoal: string;
  previousAttempts?: number;
  failureHistory?: Array<{
    type: FailureType;
    message: string;
    stage: string;
  }>;
}



export interface DecisionConfig {
  autoThreshold: number;
  interactiveThreshold: number;
  defaultTimeoutMs: number;
  enableAutoDecision: boolean;
}

export const DEFAULT_DECISION_CONFIG: DecisionConfig = {
  autoThreshold: 0.80,
  interactiveThreshold: 0.40,
  defaultTimeoutMs: 30000,
  enableAutoDecision: true,
};

export type DecisionEventType =
  | 'decision.required'
  | 'decision.made'
  | 'decision.timeout'
  | 'decision.cancelled'
  | 'decision.auto_applied';

export interface DecisionEvent {
  type: DecisionEventType;
  request?: DecisionRequest;
  response?: DecisionResponse;
  timestamp: number;
}

export interface DecisionResult {
  request: DecisionRequest;
  response?: DecisionResponse;
  timedOut: boolean;
  resolved: boolean;
}

export function createDecisionId(): string {
  return `decision_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function createDecisionRequest(
  sessionId: string,
  nodeId: string,
  type: DecisionType,
  question: string,
  options: string[],
  config: Partial<DecisionConfig> = {}
): DecisionRequest {
  const finalConfig = { ...DEFAULT_DECISION_CONFIG, ...config };

  return {
    id: createDecisionId(),
    nodeId,
    sessionId,
    type,
    question,
    options,
    timeoutMs: finalConfig.defaultTimeoutMs,
    defaultOption: options[0],
    createdAt: Date.now(),
    status: 'pending',
  };
}

export function isHighConfidence(request: DecisionRequest): boolean {
  if (!request.confidence || !request.recommended) return false;
  const recommendedConfidence = request.confidence[request.recommended];
  return recommendedConfidence !== undefined && recommendedConfidence >= 0.75;
}

export function shouldAutoApply(request: DecisionRequest): boolean {
  if (!request.confidence || !request.recommended) return false;
  const confidence = request.confidence[request.recommended] || 0;
  return confidence >= DEFAULT_DECISION_CONFIG.autoThreshold;
}

export function requiresInteraction(request: DecisionRequest): boolean {
  if (!request.confidence || !request.recommended) return true;
  const confidence = request.confidence[request.recommended] || 0;
  return confidence < DEFAULT_DECISION_CONFIG.autoThreshold &&
         confidence >= DEFAULT_DECISION_CONFIG.interactiveThreshold;
}