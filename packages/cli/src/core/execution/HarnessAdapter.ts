import type {
  HarnessAvailability,
  HarnessDescriptor,
  HarnessExecutionRequest,
  HarnessExecutionResult,
  ExecutionCheckpoint,
  HarnessHealth,
} from './types.js';

/**
 * Provider-specific execution boundary.
 *
 * The scheduler and mission runtime must never depend on a harness CLI's
 * command-line syntax, authentication model, or output format. Adapters
 * translate the normalized EamilOS contract into provider-specific work.
 */
export interface HarnessAdapter {
  readonly descriptor: HarnessDescriptor;

  detect(): Promise<HarnessAvailability>;

  start(
    request: HarnessExecutionRequest,
    onOutput?: (chunk: string) => void,
  ): Promise<HarnessExecutionResult>;

  cancel(executionId: string): Promise<void>;

  checkpoint(executionId: string): Promise<ExecutionCheckpoint>;

  resume(
    checkpoint: ExecutionCheckpoint,
    request: HarnessExecutionRequest,
    onOutput?: (chunk: string) => void,
  ): Promise<HarnessExecutionResult>;

  health(): Promise<HarnessHealth>;
}

export interface HarnessAdapterFactory {
  create(): HarnessAdapter;
}

export function isHarnessExecutionTerminal(
  status: HarnessExecutionResult['status'],
): boolean {
  return [
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT',
    'QUOTA_EXHAUSTED',
    'AUTH_FAILED',
  ].includes(status);
}
