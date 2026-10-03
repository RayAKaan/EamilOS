export type PtySessionState =
  | 'created'
  | 'starting'
  | 'running'
  | 'idle'
  | 'attached'
  | 'orphaned'
  | 'lost'
  | 'completed'
  | 'failed'
  | 'terminated';

export interface PtyDimensions {
  cols: number;
  rows: number;
}

export interface PtySessionRequest {
  sessionId: string;
  executionId: string;
  missionId: string;
  taskId: string;
  workerId: string;
  agentId: string;
  harnessId: string;
  cwd: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  dimensions?: PtyDimensions;
}

export interface PtySession {
  readonly sessionId: string;
  readonly executionId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly workerId: string;
  readonly agentId: string;
  readonly harnessId: string;
  readonly cwd: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly state: PtySessionState;
  readonly pid?: number;
  readonly dimensions: PtyDimensions;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
}

export interface PtyDataEvent {
  sessionId: string;
  executionId: string;
  stream: 'stdout' | 'stderr';
  data: string;
  timestamp: string;
}

export interface PtyExitEvent {
  sessionId: string;
  executionId: string;
  exitCode: number | null;
  signal: string | null;
  timestamp: string;
}

export interface PtyBackendSession {
  readonly pid?: number;
  write(data: string): void;
  resize(dimensions: PtyDimensions): void;
  terminate(signal?: string): void;
  onData(listener: (stream: 'stdout' | 'stderr', data: string) => void): () => void;
  onExit(listener: (exitCode: number | null, signal: string | null) => void): () => void;
  dispose(): void;
}

export interface PtyBackend {
  create(request: PtySessionRequest): Promise<PtyBackendSession>;
  attach(sessionId: string): Promise<PtyBackendSession>;
}

export interface PtyManagerEvents {
  created: PtySession;
  started: PtySession;
  attached: PtySession;
  data: PtyDataEvent;
  resized: PtySession;
  idle: PtySession;
  completed: PtyExitEvent;
  failed: PtyExitEvent;
  terminated: PtyExitEvent;
  detached: PtySession;
  orphaned: PtySession;
  lost: PtySession;
}

export interface PtyManager {
  create(request: PtySessionRequest): Promise<PtySession>;
  attach(sessionId: string): Promise<PtySession>;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, dimensions: PtyDimensions): void;
  terminate(sessionId: string, signal?: string): void;
  detach(sessionId: string): void;
  recover(sessionId: string): Promise<PtySession>;
  get(sessionId: string): PtySession | undefined;
  list(): PtySession[];
  on<K extends keyof PtyManagerEvents>(
    event: K,
    listener: (payload: PtyManagerEvents[K]) => void,
  ): () => void;
  /** Persist active sessions as orphaned without assuming process identity. */
  close(): void;
  /** Explicitly terminate active sessions before closing the manager. */
  shutdown(signal?: string): void;
}

export const DEFAULT_PTY_DIMENSIONS: PtyDimensions = {
  cols: 120,
  rows: 40,
};

export function assertPtyDimensions(dimensions: PtyDimensions): void {
  if (!Number.isInteger(dimensions.cols) || dimensions.cols < 1) {
    throw new Error('PTY columns must be a positive integer');
  }
  if (!Number.isInteger(dimensions.rows) || dimensions.rows < 1) {
    throw new Error('PTY rows must be a positive integer');
  }
}

export function assertPtySessionRequest(request: PtySessionRequest): void {
  const required: Array<keyof PtySessionRequest> = [
    'sessionId',
    'executionId',
    'missionId',
    'taskId',
    'workerId',
    'agentId',
    'harnessId',
    'cwd',
    'command',
  ];

  for (const field of required) {
    const value = request[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`PTY request requires a non-empty ${String(field)}`);
    }
  }

  if (!Array.isArray(request.args)) {
    throw new Error('PTY request args must be an array');
  }

  assertPtyDimensions(request.dimensions ?? DEFAULT_PTY_DIMENSIONS);
}
