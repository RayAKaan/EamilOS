import { DELValidationError } from './types.js';
import { DecisionResponse } from './decision-types.js';

export type OutputFormat = 'json' | 'markdown' | 'text' | 'fragment';

export interface NormalizedOutput {
  raw: string;
  sanitized: string;
  format: OutputFormat;
  detectedProviders: string[];
}

export type StageName = 'normalization' | 'extraction' | 'schema' | 'content' | 'security' | 'partial_repair' | 'write';

export interface StageTrace {
  name: StageName;
  inputHash: string;
  outputHash?: string;
  error?: DELValidationError;
  durationMs: number;
  metadata: Record<string, unknown>;
}

export interface ExecutionTrace {
  id: string;
  sessionId: string;
  stages: StageTrace[];
  totalDurationMs: number;
  startedAt: number;
  completedAt?: number;
}

export type FailureType = 'format_error' | 'schema_error' | 'content_error' | 'security_error' | 'write_error';

export interface ClassifiedError extends DELValidationError {
  failureType: FailureType;
  retryable: boolean;
  suggestedStrategy: string;
}

export type FileStatus = 'success' | 'failed' | 'pending' | 'writing' | 'skipped';

export interface FileResult {
  path: string;
  status: FileStatus;
  error?: ClassifiedError;
  hash?: string;
  bytesWritten?: number;
  validatedAt?: number;
  writtenAt?: number;
}

export type SessionStatus = 'running' | 'failed' | 'success' | 'crashed' | 'recovering' | 'paused';

export interface SessionState {
  trace: ExecutionTrace;
  files: FileResult[];
  attempts: number;
  currentStage: StageName;
  validFiles: string[];
  failedFiles: string[];
}

export interface Session {
  id: string;
  goal: string;
  status: SessionStatus;
  execution: SessionState;
  decisions: DecisionResponse[];
  createdAt: number;
  updatedAt: number;
}

export type ExecutionResultType = 'success' | 'partial_success' | 'failure';

export interface ExecutionLog {
  sessionId: string;
  trace: ExecutionTrace;
  result: ExecutionResultType;
  summary: string;
  filesWritten: number;
  filesFailed: number;
}

export type WALStatus = 'pending' | 'committed' | 'rolled_back' | 'failed';

export interface WALEntry {
  id?: number;
  sessionId: string;
  path: string;
  status: WALStatus;
  createdAt: number;
  committedAt?: number;
}

export interface CrashRecoveryResult {
  sessionId: string;
  recoveredFiles: string[];
  rolledBackFiles: string[];
  status: SessionStatus;
  canResume: boolean;
}

export interface PartialSuccessResult {
  validFiles: FileResult[];
  failedFiles: FileResult[];
  totalBytesWritten: number;
  allSucceeded: boolean;
}

export interface ExecutionCallbacks {
  onStageStart?: (stage: StageName, input: unknown) => void;
  onStageComplete?: (stage: StageName, output: unknown, trace: StageTrace) => void;
  onStageError?: (stage: StageName, error: DELValidationError, trace: StageTrace) => void;
  onAttempt?: (attempt: number, context: unknown) => void;
  onFileSuccess?: (file: FileResult) => void;
  onFileFailure?: (file: FileResult) => void;
  onPartialSuccess?: (result: PartialSuccessResult) => void;
  onTermination?: (reason: string, context: unknown) => void;
  onSessionSaved?: (sessionId: string) => void;
}

export function createEmptyExecutionTrace(sessionId: string): ExecutionTrace {
  return {
    id: generateTraceId(),
    sessionId,
    stages: [],
    totalDurationMs: 0,
    startedAt: Date.now(),
  };
}

export function createEmptySession(id: string, goal: string): Session {
  return {
    id,
    goal,
    status: 'running',
    execution: {
      trace: createEmptyExecutionTrace(id),
      files: [],
      attempts: 0,
      currentStage: 'normalization',
      validFiles: [],
      failedFiles: [],
    },
    decisions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function generateTraceId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
