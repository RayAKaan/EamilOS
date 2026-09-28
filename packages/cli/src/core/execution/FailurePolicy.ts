import type { ExecutionFailure, ExecutionState } from './types.js';

export interface FailureRecoveryDecision {
  retrySameHarness: boolean;
  fallbackToAnotherHarness: boolean;
  checkpointBeforeRecovery: boolean;
  requiresUser: boolean;
  nextState: ExecutionState;
}

const POLICIES: Record<ExecutionFailure, FailureRecoveryDecision> = {
  RATE_LIMIT: {
    retrySameHarness: false,
    fallbackToAnotherHarness: true,
    checkpointBeforeRecovery: true,
    requiresUser: false,
    nextState: 'RECOVERABLE',
  },
  QUOTA_EXHAUSTED: {
    retrySameHarness: false,
    fallbackToAnotherHarness: true,
    checkpointBeforeRecovery: true,
    requiresUser: false,
    nextState: 'QUOTA_EXHAUSTED',
  },
  AUTH_REQUIRED: {
    retrySameHarness: false,
    fallbackToAnotherHarness: true,
    checkpointBeforeRecovery: true,
    requiresUser: false,
    nextState: 'RECOVERABLE',
  },
  AUTH_FAILED: {
    retrySameHarness: false,
    fallbackToAnotherHarness: true,
    checkpointBeforeRecovery: true,
    requiresUser: false,
    nextState: 'AUTH_FAILED',
  },
  HARNESS_NOT_FOUND: {
    retrySameHarness: false,
    fallbackToAnotherHarness: true,
    checkpointBeforeRecovery: false,
    requiresUser: false,
    nextState: 'RECOVERABLE',
  },
  WORKER_UNAVAILABLE: {
    retrySameHarness: false,
    fallbackToAnotherHarness: true,
    checkpointBeforeRecovery: true,
    requiresUser: false,
    nextState: 'RECOVERABLE',
  },
  WORKER_LOST: {
    retrySameHarness: false,
    fallbackToAnotherHarness: true,
    checkpointBeforeRecovery: true,
    requiresUser: false,
    nextState: 'RECOVERABLE',
  },
  TIMEOUT: {
    retrySameHarness: true,
    fallbackToAnotherHarness: true,
    checkpointBeforeRecovery: true,
    requiresUser: false,
    nextState: 'RECOVERABLE',
  },
  CRASH: {
    retrySameHarness: true,
    fallbackToAnotherHarness: true,
    checkpointBeforeRecovery: true,
    requiresUser: false,
    nextState: 'RECOVERABLE',
  },
  CONTEXT_LIMIT: {
    retrySameHarness: false,
    fallbackToAnotherHarness: true,
    checkpointBeforeRecovery: true,
    requiresUser: false,
    nextState: 'RECOVERABLE',
  },
  INVALID_OUTPUT: {
    retrySameHarness: true,
    fallbackToAnotherHarness: true,
    checkpointBeforeRecovery: true,
    requiresUser: false,
    nextState: 'RECOVERABLE',
  },
  VALIDATION_FAILED: {
    retrySameHarness: true,
    fallbackToAnotherHarness: true,
    checkpointBeforeRecovery: true,
    requiresUser: false,
    nextState: 'RECOVERABLE',
  },
  PERMISSION_DENIED: {
    retrySameHarness: false,
    fallbackToAnotherHarness: false,
    checkpointBeforeRecovery: false,
    requiresUser: true,
    nextState: 'ESCALATED',
  },
  RESOURCE_CONFLICT: {
    retrySameHarness: false,
    fallbackToAnotherHarness: false,
    checkpointBeforeRecovery: false,
    requiresUser: false,
    nextState: 'RESCHEDULED',
  },
  UNKNOWN: {
    retrySameHarness: false,
    fallbackToAnotherHarness: true,
    checkpointBeforeRecovery: true,
    requiresUser: false,
    nextState: 'RECOVERABLE',
  },
};

export function getFailureRecoveryDecision(
  failure: ExecutionFailure,
): FailureRecoveryDecision {
  return POLICIES[failure];
}
