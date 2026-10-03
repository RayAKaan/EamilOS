import { EventEmitter } from 'node:events';
import {
  assertPtyDimensions,
  assertPtySessionRequest,
  DEFAULT_PTY_DIMENSIONS,
  type PtyBackend,
  type PtyBackendSession,
  type PtyDimensions,
  type PtyManager as PtyManagerContract,
  type PtyManagerEvents,
  type PtySession,
  type PtySessionRequest,
  type PtySessionState,
} from './PtyTypes.js';

interface ManagedSession {
  session: PtySession;
  backend: PtyBackendSession;
  disposers: Array<() => void>;
  terminationRequested: boolean;
}

function now(): string {
  return new Date().toISOString();
}

function withState(session: PtySession, state: PtySessionState, patch: Partial<PtySession> = {}): PtySession {
  return Object.freeze({
    ...session,
    ...patch,
    state,
  });
}

/**
 * Authoritative PTY lifecycle coordinator.
 *
 * This layer owns EamilOS terminal session state. A backend only owns the
 * platform-specific PTY/process mechanics.
 */
export class EamilosPtyManager implements PtyManagerContract {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly events = new EventEmitter();
  private closed = false;

  constructor(private readonly backend: PtyBackend) {}

  async create(request: PtySessionRequest): Promise<PtySession> {
    this.assertOpen();
    assertPtySessionRequest(request);

    if (this.sessions.has(request.sessionId)) {
      throw new Error(`PTY session already exists: ${request.sessionId}`);
    }

    const dimensions = request.dimensions ?? DEFAULT_PTY_DIMENSIONS;
    const created = Object.freeze({
      sessionId: request.sessionId,
      executionId: request.executionId,
      missionId: request.missionId,
      taskId: request.taskId,
      workerId: request.workerId,
      agentId: request.agentId,
      harnessId: request.harnessId,
      cwd: request.cwd,
      command: request.command,
      args: Object.freeze([...request.args]),
      state: 'created' as const,
      dimensions: Object.freeze({ ...dimensions }),
      createdAt: now(),
    });

    const backend = await Promise.resolve(this.backend.create(request));
    const managed: ManagedSession = {
      session: created,
      backend,
      disposers: [],
      terminationRequested: false,
    };
    this.sessions.set(request.sessionId, managed);
    managed.session = withState(managed.session, 'starting');
    this.emit('created', managed.session);

    this.bindBackend(request.sessionId, managed);

    managed.session = withState(
      managed.session,
      'running',
      { pid: managed.backend.pid, startedAt: now() },
    );
    this.emit('started', managed.session);

    return managed.session;
  }

  async attach(sessionId: string): Promise<PtySession> {
    this.assertOpen();
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      throw new Error(
        `PTY session is not registered with this manager: ${sessionId}`,
      );
    }

    managed.backend = await this.backend.attach(sessionId);
    managed.session = withState(managed.session, 'attached', {
      pid: managed.backend.pid,
    });
    this.bindBackend(sessionId, managed);
    this.emit('attached', managed.session);
    return managed.session;
  }

  write(sessionId: string, data: string): void {
    const managed = this.requireSession(sessionId);
    if (typeof data !== 'string') throw new Error('PTY input must be a string');
    managed.backend.write(data);
  }

  resize(sessionId: string, dimensions: PtyDimensions): void {
    const managed = this.requireSession(sessionId);
    assertPtyDimensions(dimensions);
    managed.backend.resize(dimensions);
    managed.session = withState(managed.session, managed.session.state, {
      dimensions: Object.freeze({ ...dimensions }),
    });
    this.emit('resized', managed.session);
  }

  terminate(sessionId: string, signal?: string): void {
    const managed = this.requireSession(sessionId);
    managed.terminationRequested = true;
    managed.backend.terminate(signal);
  }

  detach(sessionId: string): void {
    const managed = this.requireSession(sessionId);
    this.disposeBindings(managed);
    managed.session = withState(managed.session, 'idle');
    this.emit('detached', managed.session);
  }

  get(sessionId: string): PtySession | undefined {
    return this.sessions.get(sessionId)?.session;
  }

  list(): PtySession[] {
    return Array.from(this.sessions.values(), ({ session }) => session);
  }

  on<K extends keyof PtyManagerEvents>(
    event: K,
    listener: (payload: PtyManagerEvents[K]) => void,
  ): () => void {
    this.events.on(event, listener);
    return () => this.events.off(event, listener);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    for (const managed of this.sessions.values()) {
      this.disposeBindings(managed);
      managed.backend.dispose();
    }
    this.sessions.clear();
    this.events.removeAllListeners();
  }

  private bindBackend(sessionId: string, managed: ManagedSession): void {
    this.disposeBindings(managed);

    managed.disposers.push(
      managed.backend.onData((stream, data) => {
        const session = this.sessions.get(sessionId)?.session;
        if (!session) return;
        this.emit('data', {
          sessionId,
          executionId: session.executionId,
          stream,
          data,
          timestamp: now(),
        });
      }),
    );

    managed.disposers.push(
      managed.backend.onExit((exitCode, signal) => {
        const current = this.sessions.get(sessionId);
        if (!current) return;

        const terminalState: PtySessionState = managed.terminationRequested
          ? 'terminated'
          : exitCode === 0
            ? 'completed'
            : 'failed';

        current.session = withState(current.session, terminalState, {
          completedAt: now(),
          exitCode,
          signal,
        });

        this.emit(
          terminalState === 'completed'
            ? 'completed'
            : terminalState === 'terminated'
              ? 'terminated'
              : 'failed', {
          sessionId,
          executionId: current.session.executionId,
          exitCode,
          signal,
          timestamp: now(),
        });

        this.disposeBindings(current);
      }),
    );
  }

  private disposeBindings(managed: ManagedSession): void {
    for (const dispose of managed.disposers.splice(0)) dispose();
  }

  private requireSession(sessionId: string): ManagedSession {
    this.assertOpen();
    const managed = this.sessions.get(sessionId);
    if (!managed) throw new Error(`PTY session not found: ${sessionId}`);
    return managed;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('PTY manager is closed');
  }

  private emit<K extends keyof PtyManagerEvents>(
    event: K,
    payload: PtyManagerEvents[K],
  ): void {
    this.events.emit(event, payload);
  }
}

export class InMemoryPtyBackend implements PtyBackend {
  private readonly sessions = new Map<string, InMemoryPtyBackendSession>();

  async create(request: PtySessionRequest): Promise<PtyBackendSession> {
    if (this.sessions.has(request.sessionId)) {
      throw new Error(`PTY backend session already exists: ${request.sessionId}`);
    }
    const session = new InMemoryPtyBackendSession(
      request.sessionId,
      request.dimensions ?? DEFAULT_PTY_DIMENSIONS,
    );
    this.sessions.set(request.sessionId, session);
    return session;
  }

  async attach(sessionId: string): Promise<PtyBackendSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`PTY backend session not found: ${sessionId}`);
    return session;
  }

  emitData(sessionId: string, stream: 'stdout' | 'stderr', data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`PTY backend session not found: ${sessionId}`);
    session.emitData(stream, data);
  }

  exit(sessionId: string, exitCode: number | null = 0, signal: string | null = null): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`PTY backend session not found: ${sessionId}`);
    session.emitExit(exitCode, signal);
  }

  get(sessionId: string): InMemoryPtyBackendSession | undefined {
    return this.sessions.get(sessionId);
  }
}

export class InMemoryPtyBackendSession implements PtyBackendSession {
  readonly writes: string[] = [];
  readonly resizeHistory: PtyDimensions[] = [];
  readonly terminationSignals: Array<string | undefined> = [];

  private readonly events = new EventEmitter();
  private disposed = false;

  constructor(
    private readonly sessionId: string,
    initialDimensions: PtyDimensions,
    readonly pid = 0,
  ) {
    this.resizeHistory.push({ ...initialDimensions });
  }

  write(data: string): void {
    if (this.disposed) throw new Error(`PTY backend session disposed: ${this.sessionId}`);
    this.writes.push(data);
  }

  resize(dimensions: PtyDimensions): void {
    if (this.disposed) throw new Error(`PTY backend session disposed: ${this.sessionId}`);
    this.resizeHistory.push({ ...dimensions });
  }

  terminate(signal?: string): void {
    if (this.disposed) return;
    this.terminationSignals.push(signal);
  }

  onData(listener: (stream: 'stdout' | 'stderr', data: string) => void): () => void {
    this.events.on('data', listener);
    return () => this.events.off('data', listener);
  }

  onExit(listener: (exitCode: number | null, signal: string | null) => void): () => void {
    this.events.on('exit', listener);
    return () => this.events.off('exit', listener);
  }

  emitData(stream: 'stdout' | 'stderr', data: string): void {
    this.events.emit('data', stream, data);
  }

  emitExit(exitCode: number | null, signal: string | null): void {
    this.events.emit('exit', exitCode, signal);
  }

  dispose(): void {
    this.disposed = true;
    this.events.removeAllListeners();
  }
}
