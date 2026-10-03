import type {
  PtyDataEvent,
  PtyManager,
  PtySession,
  PtySessionState,
} from './PtyTypes.js';

export interface TerminalOutputChunk {
  stream: 'stdout' | 'stderr';
  data: string;
  timestamp: string;
}

export interface AgentTerminalView {
  session: PtySession;
  selected: boolean;
  output: readonly TerminalOutputChunk[];
}

export interface MultiTerminalSnapshot {
  selectedSessionId?: string;
  terminals: readonly AgentTerminalView[];
  updatedAt: string;
}

/**
 * Read-only projection of the authoritative PTY manager.
 *
 * It owns only presentation state (selection and bounded output history).
 * It never creates, terminates, resizes, or mutates PTY sessions.
 */
export class MultiTerminalProjection {
  private readonly sessions = new Map<string, PtySession>();
  private readonly output = new Map<string, TerminalOutputChunk[]>();
  private readonly maxOutputChunks: number;
  private selectedSessionId: string | undefined;
  private updatedAt = new Date().toISOString();
  private readonly disposers: Array<() => void>;

  constructor(
    private readonly pty: PtyManager,
    options: { maxOutputChunks?: number } = {},
  ) {
    this.maxOutputChunks = Math.max(1, Math.floor(options.maxOutputChunks ?? 500));
    for (const session of pty.list()) this.sessions.set(session.sessionId, session);

    this.disposers = [
      pty.on('created', session => this.upsert(session)),
      pty.on('started', session => this.upsert(session)),
      pty.on('attached', session => this.upsert(session)),
      pty.on('resized', session => this.upsert(session)),
      pty.on('detached', session => this.upsert(session)),
      pty.on('orphaned', session => this.upsert(session)),
      pty.on('lost', session => this.upsert(session)),
      pty.on('data', event => this.appendOutput(event)),
      pty.on('completed', event => this.updateTerminalEvent(event.executionId, 'completed', event.exitCode, event.signal)),
      pty.on('failed', event => this.updateTerminalEvent(event.executionId, 'failed', event.exitCode, event.signal)),
      pty.on('terminated', event => this.updateTerminalEvent(event.executionId, 'terminated', event.exitCode, event.signal)),
    ];

    if (!this.selectedSessionId && this.sessions.size > 0) {
      this.selectedSessionId = this.sessions.keys().next().value;
    }
  }

  snapshot(): MultiTerminalSnapshot {
    const terminals = [...this.sessions.values()]
      .sort(compareSessions)
      .map(session => ({
        session,
        selected: session.sessionId === this.selectedSessionId,
        output: Object.freeze([...(this.output.get(session.sessionId) ?? [])]),
      }));

    return Object.freeze({
      selectedSessionId: this.selectedSessionId,
      terminals: Object.freeze(terminals),
      updatedAt: this.updatedAt,
    });
  }

  select(sessionId: string): MultiTerminalSnapshot {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`PTY_SESSION_NOT_FOUND: ${sessionId}`);
    }
    this.selectedSessionId = sessionId;
    this.touch();
    return this.snapshot();
  }

  selectNext(): MultiTerminalSnapshot {
    const ids = [...this.sessions.keys()].sort();
    if (ids.length === 0) return this.snapshot();

    const index = this.selectedSessionId ? ids.indexOf(this.selectedSessionId) : -1;
    this.selectedSessionId = ids[(index + 1) % ids.length];
    this.touch();
    return this.snapshot();
  }

  selectPrevious(): MultiTerminalSnapshot {
    const ids = [...this.sessions.keys()].sort();
    if (ids.length === 0) return this.snapshot();

    const index = this.selectedSessionId ? ids.indexOf(this.selectedSessionId) : 0;
    this.selectedSessionId = ids[(index - 1 + ids.length) % ids.length];
    this.touch();
    return this.snapshot();
  }

  selected(): AgentTerminalView | undefined {
    return this.snapshot().terminals.find(terminal => terminal.selected);
  }

  close(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.sessions.clear();
    this.output.clear();
    this.selectedSessionId = undefined;
  }

  private upsert(session: PtySession): void {
    this.sessions.set(session.sessionId, session);
    if (!this.selectedSessionId) this.selectedSessionId = session.sessionId;
    this.touch();
  }

  private appendOutput(event: PtyDataEvent): void {
    if (!this.sessions.has(event.sessionId)) return;
    const chunks = this.output.get(event.sessionId) ?? [];
    chunks.push({
      stream: event.stream,
      data: event.data,
      timestamp: event.timestamp,
    });
    if (chunks.length > this.maxOutputChunks) {
      chunks.splice(0, chunks.length - this.maxOutputChunks);
    }
    this.output.set(event.sessionId, chunks);
    this.touch();
  }

  private updateTerminalEvent(
    executionId: string,
    state: PtySessionState,
    exitCode: number | null,
    signal: string | null,
  ): void {
    const session = [...this.sessions.values()].find(item => item.executionId === executionId);
    if (!session) return;
    this.upsert(Object.freeze({
      ...session,
      state,
      exitCode,
      signal,
      completedAt: new Date().toISOString(),
    }));
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }
}

function compareSessions(a: PtySession, b: PtySession): number {
  return a.createdAt.localeCompare(b.createdAt)
    || a.sessionId.localeCompare(b.sessionId);
}
