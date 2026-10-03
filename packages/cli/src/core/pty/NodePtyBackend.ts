import * as nodePty from 'node-pty';
import type {
  PtyBackend,
  PtyBackendSession,
  PtyDimensions,
  PtySessionRequest,
} from './PtyTypes.js';

export interface NodePtyProcessLike {
  readonly pid: number;
  readonly cols: number;
  readonly rows: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
}

export interface NodePtyModuleLike {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
    },
  ): NodePtyProcessLike;
}

function signalName(signal: number | undefined): string | null {
  if (signal === undefined || signal === 0) return null;
  return String(signal);
}

class NodePtyBackendSession implements PtyBackendSession {
  readonly pid: number;

  constructor(
    private readonly process: NodePtyProcessLike,
    private readonly sessionId: string,
  ) {
    this.pid = process.pid;
  }

  write(data: string): void {
    this.process.write(data);
  }

  resize(dimensions: PtyDimensions): void {
    this.process.resize(dimensions.cols, dimensions.rows);
  }

  terminate(signal?: string): void {
    this.process.kill(signal);
  }

  onData(listener: (stream: 'stdout' | 'stderr', data: string) => void): () => void {
    const subscription = this.process.onData((data) => listener('stdout', data));
    return () => subscription.dispose();
  }

  onExit(listener: (exitCode: number | null, signal: string | null) => void): () => void {
    const subscription = this.process.onExit((event) => {
      listener(event.exitCode, signalName(event.signal));
    });
    return () => subscription.dispose();
  }

  dispose(): void {
    // node-pty subscriptions are explicitly disposed by the manager.
    // The process itself remains under manager lifecycle control.
    void this.sessionId;
  }
}

/**
 * Native PTY backend backed by node-pty.
 *
 * node-pty provides pseudoterminals on Linux, macOS and Windows. EamilOS
 * deliberately keeps this platform detail behind PtyBackend so the manager
 * remains platform-neutral.
 *
 * Attach is process-local in 5B. Durable/restart-safe terminal attachment
 * belongs to Phase 5C.
 */
export class NodePtyBackend implements PtyBackend {
  private readonly sessions = new Map<string, NodePtyProcessLike>();

  constructor(private readonly pty: NodePtyModuleLike = nodePty) {}

  async create(request: PtySessionRequest): Promise<PtyBackendSession> {
    if (this.sessions.has(request.sessionId)) {
      throw new Error(`PTY backend session already exists: ${request.sessionId}`);
    }

    const dimensions = request.dimensions ?? { cols: 120, rows: 40 };
    const env = {
      ...process.env,
      ...(request.env ?? {}),
    } as Record<string, string>;

    const process = this.pty.spawn(request.command, request.args, {
      name: 'xterm-256color',
      cols: dimensions.cols,
      rows: dimensions.rows,
      cwd: request.cwd,
      env,
    });

    this.sessions.set(request.sessionId, process);
    return new NodePtyBackendSession(process, request.sessionId);
  }

  async attach(sessionId: string): Promise<PtyBackendSession> {
    const process = this.sessions.get(sessionId);
    if (!process) {
      throw new Error(
        `PTY backend session not found in current process: ${sessionId}`,
      );
    }

    return new NodePtyBackendSession(process, sessionId);
  }
}
