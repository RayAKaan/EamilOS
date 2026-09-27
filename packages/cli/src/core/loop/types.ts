import type { DecisionContext, DecisionTrigger, JevDecision } from '../intelligence/types.js';
import type { GraphHealth, GraphSnapshot } from '../cognitive-graph/types.js';
import type { RuntimeExecutionResult, RuntimeValidationResult } from '../runtime/types.js';

export const LOOP_PHASES = ['OBSERVE','INTERPRET','PLAN','EXECUTE','MEASURE','VALIDATE','ADAPT'] as const;
export type LoopPhase = typeof LOOP_PHASES[number];

export type LoopStatus = 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ESCALATED' | 'FAILED' | 'ABORTED';

export type LoopAction =
  | 'CONTINUE'
  | 'PLAN'
  | 'EXECUTE'
  | 'RETRY'
  | 'REASSIGN'
  | 'REPLAN'
  | 'VERIFY'
  | 'RECOVER'
  | 'WAIT'
  | 'COMPLETE'
  | 'ESCALATE'
  | 'ABORT';

export interface LoopObservation {
  missionId: string;
  iteration: number;
  observedAt: string;
  graph: GraphSnapshot;
  graphHealth: GraphHealth;
  context: DecisionContext;
  readyTasks: string[];
  runningTasks: string[];
  blockedTasks: string[];
  failedTasks: string[];
  completionRatio: number;
  progressMetric: number;
}

export interface LoopInterpretation {
  action: LoopAction;
  trigger: DecisionTrigger;
  reason: string;
  taskIds: string[];
  decision?: JevDecision;
  requiresPlanning: boolean;
}

export interface LoopPlanResult {
  planned: boolean;
  action: LoopAction;
  message?: string;
  decision?: JevDecision;
}

export interface LoopMeasurement {
  measuredAt: string;
  progressMetric: number;
  progressDelta: number;
  taskStateChanges: number;
  graphVersion: number;
  execution?: RuntimeExecutionResult;
}

export interface LoopValidation {
  passed: boolean;
  result?: RuntimeValidationResult;
  reasons: string[];
}

export interface LoopAdaptation {
  action: LoopAction;
  trigger: DecisionTrigger;
  progress: boolean;
  message: string;
}

export interface LoopCounters {
  iterations: number;
  decisions: number;
  plans: number;
  executions: number;
  validations: number;
  recoveries: number;
  replans: number;
  stagnantIterations: number;
}

export interface AutonomousLoopState {
  missionId: string;
  status: LoopStatus;
  phase: LoopPhase;
  iteration: number;
  graphVersion: number;
  lastProgressMetric: number;
  counters: LoopCounters;
  lastTrigger?: DecisionTrigger;
  lastAction?: LoopAction;
  lastTaskId?: string;
  lastDecisionId?: string;
  lastExecutionId?: string;
  lastCheckpointId?: string;
  terminationReason?: string;
  startedAt: string;
  updatedAt: string;
}

export interface AutonomousLoopResult {
  status: LoopStatus;
  missionId: string;
  iterations: number;
  decisions: number;
  plans: number;
  executions: number;
  validations: number;
  recoveries: number;
  replans: number;
  stagnantIterations: number;
  finalGraphVersion: number;
  terminationReason: string;
}

export interface AutonomousLoopPolicy {
  maxIterations: number;
  maxDecisions: number;
  maxPlans: number;
  maxExecutions: number;
  maxValidations: number;
  maxRecoveries: number;
  maxReplans: number;
  maxStagnantIterations: number;
  maxWallTimeMs?: number;
  requireGraphConsistency: boolean;
  allowAutonomousExecution: boolean;
}

export interface AutonomousLoopComponents {
  observe(missionId: string, iteration: number): Promise<LoopObservation> | LoopObservation;
  interpret(observation: LoopObservation): Promise<LoopInterpretation> | LoopInterpretation;
  plan(missionId: string, observation: LoopObservation, interpretation: LoopInterpretation): Promise<LoopPlanResult>;
  execute(missionId: string, taskId: string, interpretation: LoopInterpretation): Promise<RuntimeExecutionResult>;
  measure(missionId: string, before: LoopObservation, execution?: RuntimeExecutionResult): Promise<LoopMeasurement>;
  validate(missionId: string, taskId: string, execution?: RuntimeExecutionResult): Promise<LoopValidation>;
  adapt(missionId: string, observation: LoopObservation, measurement: LoopMeasurement, validation: LoopValidation, interpretation: LoopInterpretation): Promise<LoopAdaptation>;
}

export interface LoopEvent {
  eventId: string;
  missionId: string;
  iteration: number;
  phase: LoopPhase;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
  previousEventHash?: string;
  hash: string;
}
