import { createHash } from 'node:crypto';
import type { FleetWorker } from '../comms/a2a/EamilosFleetRegistry.js';
import type { ScheduleDecision, SchedulingCandidate, SchedulerDispatcher } from '../scheduler/GlobalSchedulerTypes.js';
import type { PtyManager, PtySession } from './PtyTypes.js';

export interface PtyDispatchInput {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  dimensions?: { cols: number; rows: number };
}

export interface PtyDispatchInputResolver {
  resolve(
    decision: ScheduleDecision,
    candidate: SchedulingCandidate,
    worker: FleetWorker,
  ): PtyDispatchInput;
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
    const input = candidate.task.inputs;
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
 * Scheduler -> PTY bridge.
 *
 * The scheduler remains authoritative for execution decisions and leases.
 * The PTY manager remains authoritative for terminal lifecycle.
 */
export class SchedulerPtyDispatcher implements SchedulerDispatcher {
  private readonly resolver: PtyDispatchInputResolver;
  private readonly decisions = new Map<string, ScheduleDecision>();
  private readonly disposers: Array<() => void>;

  constructor(
    private readonly options: SchedulerPtyDispatcherOptions,
    private readonly completeExecution: (
      executionId: string,
      state: 'completed' | 'failed' | 'cancelled',
    ) => void,
  ) {
    this.resolver = options.resolver ?? DEFAULT_RESOLVER;
    this.disposers = [
      options.pty.on('completed', event => this.handleTerminal(event.executionId, 'completed')),
      options.pty.on('failed', event => this.handleTerminal(event.executionId, 'failed')),
      options.pty.on('terminated', event => this.handleTerminal(event.executionId, 'cancelled')),
      options.pty.on('lost', session => this.handleTerminal(session.executionId, 'failed')),
    ];
  }

  async dispatch(
    decision: ScheduleDecision,
    candidate: SchedulingCandidate,
    worker: FleetWorker,
  ): Promise<void> {
    const input = this.resolver.resolve(decision, candidate, worker);
    const session = await this.options.pty.create({
      sessionId: sessionIdFor(decision.executionId),
      executionId: decision.executionId,
      missionId: decision.missionId,
      taskId: decision.taskId,
      workerId: decision.workerId,
      agentId: decision.agentId,
      harnessId: decision.harnessId,
      cwd: input.cwd ?? (typeof worker.metadata.workingDir === 'string' ? worker.metadata.workingDir : process.cwd()),
      command: input.command,
      args: input.args ?? [],
      env: input.env,
      dimensions: input.dimensions,
    });

    this.decisions.set(decision.executionId, decision);
    this.options.onStarted?.(session, decision);
  }

  close(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.decisions.clear();
  }

  private handleTerminal(
    executionId: string,
    state: 'completed' | 'failed' | 'cancelled',
  ): void {
    const decision = this.decisions.get(executionId);
    if (!decision) return;

    try {
      const session = this.options.pty.get(sessionIdFor(executionId));
      if (!session) throw new Error('PTY_SESSION_NOT_FOUND_FOR_EXECUTION');
      this.completeExecution(executionId, state);
      this.options.onTerminal?.(session, decision);
      this.decisions.delete(executionId);
    } catch (error) {
      this.options.onError?.(error, decision);
    }
  }
}

export function ptySessionIdForExecution(executionId: string): string {
  return sessionIdFor(executionId);
}
