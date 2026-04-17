export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T, E>(value: T): Result<T, E> {
  return { ok: true, value };
}

export function err<T, E>(error: E): Result<T, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok === true;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return result.ok === false;
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`unwrap called on Err: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

export function flatMap<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

export type SafePath = string & { readonly __brand: unique symbol };
export type ValidatedCode = string & { readonly __brand: unique symbol };

export function brandSafePath(path: string): SafePath {
  return path as SafePath;
}

export function brandValidatedCode(code: string): ValidatedCode {
  return code as ValidatedCode;
}

export type ProviderId = 'ollama' | 'openai' | 'anthropic' | 'cli-agent';

export interface RawProviderOutput {
  providerId: ProviderId;
  rawText: string;
  metadata: {
    model: string;
    latencyMs: number;
    tokenCount: number;
  };
}

export enum DELErrorCode {
  EXTRACTION_FAILURE = 'EXTRACTION_FAILURE',
  SCHEMA_MISMATCH = 'SCHEMA_MISMATCH',
  PLACEHOLDER_DETECTED = 'PLACEHOLDER_DETECTED',
  LOW_CODE_DENSITY = 'LOW_CODE_DENSITY',
  PATH_TRAVERSAL = 'PATH_TRAVERSAL',
  SECRET_DETECTED = 'SECRET_DETECTED',
  SYNTAX_ERROR = 'SYNTAX_ERROR',
}

export type ValidationStage = 'extraction' | 'schema' | 'content' | 'security' | 'write';

export interface DELValidationError {
  code: DELErrorCode;
  message: string;
  context: string;
  stage: ValidationStage;
  filePath?: string;
}

export interface ExtractedFile {
  path: string;
  content: string;
}

export interface ExtractedPayload {
  files: ExtractedFile[];
  extractionStrategy: string;
}

export type EscalationLevel = 'standard' | 'strict' | 'decompose';

export interface RetryContext {
  attempt: number;
  maxAttempts: number;
  failureHistory: DELValidationError[];
  escalationLevel: EscalationLevel;
}

export interface RepairPrompt {
  systemInstruction: string;
  correctionContext: string;
}

export interface GuaranteedFile {
  path: SafePath;
  content: ValidatedCode;
  hash: string;
}

export interface ExecutionReceipt {
  success: boolean;
  filesWritten: GuaranteedFile[];
  bytesWritten: number;
  durationMs: number;
  errors: DELValidationError[];
  extractionStrategy: string;
  attemptCount: number;
}

export interface DELConfig {
  workspaceRoot: string;
  maxAttempts: number;
  strictMode: boolean;
  allowDescriptiveContent: boolean;
  maxFileSizeBytes: number;
}

export const DEFAULT_DEL_CONFIG: DELConfig = {
  workspaceRoot: process.cwd(),
  maxAttempts: 3,
  strictMode: false,
  allowDescriptiveContent: false,
  maxFileSizeBytes: 10 * 1024 * 1024,
};
