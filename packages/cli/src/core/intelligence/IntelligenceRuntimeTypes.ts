export type IntelligenceRequestType =
  | 'STRATEGIC_DECISION'
  | 'TASK_DECISION'
  | 'RECOVERY_DECISION'
  | 'PLANNING'
  | 'VALIDATION'
  | 'AGENT_SELECTION'
  | 'PARALLELIZATION';

export type IntelligencePriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export type IntelligenceResponseStatus =
  | 'SUCCESS'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'INVALID'
  | 'REJECTED'
  | 'FAILED';

export type IntelligenceHealthStatus =
  | 'READY'
  | 'DEGRADED'
  | 'NOT_CONFIGURED'
  | 'UNAVAILABLE'
  | 'FAILED';

export interface IntelligenceBudget {
  maxLatencyMs?: number;
  maxCostUsd?: number;
  maxTokens?: number;
}

export interface IntelligenceUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface IntelligenceError {
  code: string;
  message: string;
  retryable: boolean;
  cause?: string;
}

export interface IntelligenceCapabilities {
  strategicDecision: boolean;
  taskDecision: boolean;
  recoveryDecision: boolean;
  planning: boolean;
  validationAssessment: boolean;
  agentSelection: boolean;
  parallelization: boolean;
  local: boolean;
  remote: boolean;
  streaming: boolean;
}

export interface IntelligenceHealth {
  status: IntelligenceHealthStatus;
  providerId: string;
  checkedAt: string;
  latencyMs?: number;
  error?: string;
  capabilities: IntelligenceCapabilities;
}

export interface IntelligenceRequest<TContext = unknown> {
  requestId: string;
  missionId: string;
  type: IntelligenceRequestType;
  priority: IntelligencePriority;
  contextVersion: number;
  contextHash: string;
  context: TContext;
  deadline?: string;
  budget?: IntelligenceBudget;
  preferredProviders?: string[];
  fallbackProviders?: string[];
  metadata?: Record<string, unknown>;
}

export interface IntelligenceResponse<TResult = unknown> {
  requestId: string;
  providerId: string;
  providerVersion?: string;
  model?: string;
  status: IntelligenceResponseStatus;
  result?: TResult;
  confidence?: number;
  latencyMs: number;
  usage?: IntelligenceUsage;
  contextVersion: number;
  contextHash: string;
  error?: IntelligenceError;
}

export interface IntelligenceProvider {
  readonly id: string;
  capabilities(): IntelligenceCapabilities;
  initialize(): Promise<void>;
  health(): Promise<IntelligenceHealth>;
  evaluate(request: IntelligenceRequest): Promise<IntelligenceResponse>;
  shutdown(): Promise<void>;
}

export interface IntelligenceRoute {
  requestType: IntelligenceRequestType;
  providerIds: string[];
  selectedProviderId?: string;
  reason: string;
}

export interface IntelligenceEvent {
  eventId: string;
  type:
    | 'intelligence.requested'
    | 'intelligence.started'
    | 'intelligence.completed'
    | 'intelligence.failed'
    | 'intelligence.degraded'
    | 'intelligence.fallback'
    | 'intelligence.rejected';
  timestamp: string;
  missionId: string;
  requestId: string;
  providerId?: string;
  contextVersion: number;
  contextHash: string;
  status?: IntelligenceResponseStatus;
  data?: Record<string, unknown>;
}

export interface IntelligenceEventSink {
  emit(event: IntelligenceEvent): Promise<void> | void;
}

export interface IntelligenceRuntimeHealth {
  status: IntelligenceHealthStatus;
  providers: IntelligenceHealth[];
  checkedAt: string;
}

export interface IntelligenceRuntime {
  request<TContext = unknown, TResult = unknown>(
    request: IntelligenceRequest<TContext>,
  ): Promise<IntelligenceResponse<TResult>>;
  health(): Promise<IntelligenceRuntimeHealth>;
  route(request: IntelligenceRequest): Promise<IntelligenceRoute>;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}
