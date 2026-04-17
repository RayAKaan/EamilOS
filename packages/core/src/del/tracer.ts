import { createHash } from 'crypto';
import { ExecutionTrace, StageTrace, StageName } from './stateful-types.js';
import { DELValidationError, DELErrorCode, ValidationStage } from './types.js';

export interface TracedResult<T> {
  success: boolean;
  output?: T;
  error?: DELValidationError;
  trace: StageTrace;
}

export class ExecutionTracer {
  private trace: ExecutionTrace;
  private currentStage: StageName | null = null;
  private stageStartTime: number = 0;
  private stageInputHash: string = '';

  constructor(trace: ExecutionTrace) {
    this.trace = trace;
  }

  getTrace(): ExecutionTrace {
    return this.trace;
  }

  getCurrentStage(): StageName | null {
    return this.currentStage;
  }

  startStage(name: StageName, input: unknown): void {
    this.currentStage = name;
    this.stageStartTime = Date.now();
    this.stageInputHash = this.hashInput(input);
  }

  private hashInput(input: unknown): string {
    const serialized = typeof input === 'string' ? input : JSON.stringify(input);
    return createHash('sha256').update(serialized, 'utf-8').digest('hex');
  }

  completeStage(output: unknown, metadata: Record<string, unknown> = {}): StageTrace {
    if (!this.currentStage) {
      throw new Error('No stage started');
    }

    const durationMs = Date.now() - this.stageStartTime;
    const outputHash = output !== undefined ? this.hashInput(output) : undefined;

    const stageTrace: StageTrace = {
      name: this.currentStage,
      inputHash: this.stageInputHash,
      outputHash,
      durationMs,
      metadata,
    };

    this.trace.stages.push(stageTrace);
    this.trace.totalDurationMs += durationMs;

    this.currentStage = null;
    this.stageStartTime = 0;
    this.stageInputHash = '';

    return stageTrace;
  }

  failStage(error: DELValidationError, metadata: Record<string, unknown> = {}): StageTrace {
    if (!this.currentStage) {
      throw new Error('No stage started');
    }

    const durationMs = Date.now() - this.stageStartTime;

    const stageTrace: StageTrace = {
      name: this.currentStage,
      inputHash: this.stageInputHash,
      error,
      durationMs,
      metadata,
    };

    this.trace.stages.push(stageTrace);
    this.trace.totalDurationMs += durationMs;

    this.currentStage = null;
    this.stageStartTime = 0;
    this.stageInputHash = '';

    return stageTrace;
  }

  finalize(): ExecutionTrace {
    this.trace.completedAt = Date.now();
    return this.trace;
  }

  getStageByName(name: StageName): StageTrace | undefined {
    return this.trace.stages.find(s => s.name === name);
  }

  getTotalDuration(): number {
    return this.trace.totalDurationMs;
  }

  getStageDurations(): Record<StageName, number> {
    const durations: Partial<Record<StageName, number>> = {};
    for (const stage of this.trace.stages) {
      durations[stage.name] = stage.durationMs;
    }
    return durations as Record<StageName, number>;
  }

  hasErrors(): boolean {
    return this.trace.stages.some(s => s.error !== undefined);
  }

  getErrors(): Array<{ stage: StageName; error: DELValidationError }> {
    return this.trace.stages
      .filter(s => s.error !== undefined)
      .map(s => ({ stage: s.name, error: s.error! }));
  }
}

export function createTracer(trace: ExecutionTrace): ExecutionTracer {
  return new ExecutionTracer(trace);
}

export function traceStage<T>(
  tracer: ExecutionTracer,
  stageName: StageName,
  input: unknown,
  fn: () => T
): T {
  tracer.startStage(stageName, input);
  try {
    const result = fn();
    tracer.completeStage(result);
    return result;
  } catch (error) {
    const errorCode = (error as { code?: string }).code || 'EXTRACTION_FAILURE';
    const validationError: DELValidationError = {
      code: errorCode as DELErrorCode,
      message: error instanceof Error ? error.message : String(error),
      context: String(error),
      stage: stageName as ValidationStage,
    };
    tracer.failStage(validationError);
    throw error;
  }
}

export async function traceStageAsync<T>(
  tracer: ExecutionTracer,
  stageName: StageName,
  input: unknown,
  fn: () => Promise<T>
): Promise<T> {
  tracer.startStage(stageName, input);
  try {
    const result = await fn();
    tracer.completeStage(result);
    return result;
  } catch (error) {
    const errorCode = (error as { code?: string }).code || 'EXTRACTION_FAILURE';
    const validationError: DELValidationError = {
      code: errorCode as DELErrorCode,
      message: error instanceof Error ? error.message : String(error),
      context: String(error),
      stage: stageName as ValidationStage,
    };
    tracer.failStage(validationError);
    throw error;
  }
}
