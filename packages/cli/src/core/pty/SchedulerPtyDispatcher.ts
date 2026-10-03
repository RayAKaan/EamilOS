import { createHash } from 'node:crypto';
import type { FleetWorker } from '../comms/a2a/EamilosFleetRegistry.js';
import type { ScheduleDecision, SchedulingCandidate, SchedulerDispatcher } from '../scheduler/GlobalSchedulerTypes.js';
import type { PtyManager, PtySessionRequest } from './PtyTypes.js';
import type { PtySession } from './PtyTypes.js';

export interface PtyDispatchInput {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  dimensions?: { cols: number; rows: number };
}

export interface PtyDispatchInputResolver {
  resolve(decision: ScheduleDecision, candidate: SchedulingCandidate, worker: FleetWorker): PtyDispatchInput;
}

export interface SchedulerPtyDispatcherOptions {
  pty: PtyManager;
  resolver?: PtyDispatchInputResolver;
  onStarted?: (session: PtySession, decision: ScheduleDecision) => void;
  onTerminal?: (session: PtySession, decision: ScheduleDecision) => void;
  onError?: (error: unknown, decision: ScheduleDecision) => void;
}

const DEFAULT_RESOLVER: PtyDispatchInputResolver = {
  resolve(_decision, candidate) {
    const input = candidate.task.inputs as Record<string, unknown>;
    const command = input.command;
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new Error('PTY_DISPATCH_COMMAND_MISSING');
    }

    const args = Array.isArray(input.args)
      ? input.args.filter((value): value is string => typeof value === 'string')
      : [];

    const cwd = typeof input.cwd === 'string' && input.cwd.trim().length > 0
      ? input.cwd
      : undefined;

    const env = input.env && typeof input.env === 'object' && !Array.isArray(input.env)
      ? Object.fromEntries(
          Object.entries(input.env as Record<string, unknown>)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
      : undefined;

    const dimensions = input.dimensions && typeof input.dimensions === 'object'
      ? input.dimensions as { cols: number; rows: number }
      : undefined;

    return { command, args, cwd, env, dimensions };
  },
};

function sessionIdFor(executionId: string): string {
  return `pty_${createHash('sha256').update(executionId).digest('hex').slice(0, 32)}`;
}

/**
 * Bridges the scheduler's dispatch contract to the authoritative PTY manager.
 *
 * The scheduler still owns execution decisions and resource leases. The PTY
 * manager owns terminal lifecycle. Terminal exit is translated back into a
 * scheduler terminal state through the supplied completion callback.
 */
export class SchedulerPtyDispatcher implements SchedulerDispatcher {
  private readonly resolver: PtyDispatchInputResolver;
  private readonly terminalBindings = new Map<string, () => void>();

  constructor(
    private readonly options: SchedulerPtyDispatcherOptions,
    private readonly completeExecution: (executionId: string, state: 'completed' | 'failed' | 'cancelled') => void,
  ) {
    this.resolver = options.resolver ?? DEFAULT_RESOLVER;
    this.bindTerminalEvents();
  }

  async dispatch(
    decision: ScheduleDecision,
    candidate: SchedulingCandidate,
    worker: FleetWorker,
  ): Promise<void> {
    const input = this.resolver.resolve(decision, candidate, worker);
    const mission = candidate.task.missionId;

    const session = await this.options.pty.create({
      sessionId: sessionIdFor(decision.executionId),
      executionId: decision.executionId,
      missionId: mission,
      taskId: candidate.taskId,
      workerId: decision.workerId,
      agentId: decision.agentId,
      harnessId: decision.harnessId,
      cwd: input.cwd ?? worker.metadata?.workingDir as string ?? process.cwd(),
      command: input.command,
      args: input.args ?? [],
      env: input.env,
      dimensions: input.dimensions,
    });

    this.options.onStarted?.(session, decision);
  }

  close(): void {
    for (const dispose of this.terminalBindings.values()) dispose();
    this.terminalBindings.clear();
  }

  private bindTerminalEvents(): void {
    const events = [
      this.options.pty.on('completed', event => this.handleTerminal(event.executionId, 'completed')),
      this.options.pty.on('failed', event => this.handleTerminal(event.executionId, 'failed')),
      this.options.pty.on('terminated', event => this.handleTerminal(event.executionId, 'cancelled')),
      this.options.pty.on('orphaned', session => this.options.onTerminal?.(session, this.decisionFor(session.executionId))),
      this.options.pty.on('lost', session => this.options.onTerminal?.(session, this.decisionFor(session.executionId))),
    ];

    this.terminalBindings.set('events', () => {
      for (const dispose of events) dispose();
    });
  }

  private handleTerminal(executionId: string, state: 'completed' | 'failed' | 'cancelled'): void {
    const decision = this.decisionFor(executionId);
    try {
      this.completeExecution(executionId, state);
      const session = this.options.pty.get(sessionIdFor(executionId));
      if (session) this.options.onTerminal?.(session, decision);
    } catch (error) {
      this.options.onError?.(error, decision);
    }
  }

  private decisionFor(executionId: string): ScheduleDecision {
    // Completion callers can supply richer correlation externally. The dispatcher
    // only requires executionId for scheduler completion, so this placeholder
    // preserves the callback boundary without making the PTY manager scheduler-aware.
    return {
      decisionId: executionId,
      idempotencyKey: executionId,
      schedulerRevision: 0,
      missionId: '',
      taskId: '',
      executionId,
      workerId: '',
      agentId: '',
      harnessId: '',
      priority: 'MEDIUM',
      fencingToken: 0,
      leaseId: '',
      state: 'dispatched',
      createdAt: '',
      updatedAt: '',
    };
  }
}
