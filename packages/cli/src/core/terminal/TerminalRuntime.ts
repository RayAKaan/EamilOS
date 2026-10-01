import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export interface TerminalSessionSpec {
  readonly id?: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly env?: Record<string, string | undefined>;
  readonly maxOutputBytes?: number;
}

export interface TerminalSessionSnapshot {
  readonly id: string;
  readonly pid?: number;
  readonly command: string;
  readonly cwd: string;
  readonly running: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
}

interface RuntimeSession {
  spec: TerminalSessionSpec;
  process: ChildProcess;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startedAt: number;
  finishedAt?: number;
}

export class TerminalRuntime {
  private readonly sessions = new Map<string, RuntimeSession>();

  start(spec: TerminalSessionSpec, signal?: AbortSignal): TerminalSessionSnapshot {
    const id = spec.id ?? randomUUID();
    if (this.sessions.has(id)) throw new Error(`Terminal session already exists: ${id}`);

    const maxBytes = spec.maxOutputBytes ?? 1_000_000;
    const child = spawn(spec.command, [...(spec.args ?? [])], {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const session: RuntimeSession = {
      spec: { ...spec, id },
      process: child,
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: null,
      startedAt: Date.now(),
    };
    this.sessions.set(id, session);

    const append = (key: 'stdout' | 'stderr', chunk: Buffer) => {
      const current = session[key] + chunk.toString();
      session[key] = current.length > maxBytes ? current.slice(current.length - maxBytes) : current;
    };
    child.stdout?.on('data', chunk => append('stdout', chunk));
    child.stderr?.on('data', chunk => append('stderr', chunk));
    child.once('error', error => { session.stderr += `\n${error.message}`; });
    child.once('close', (code, sig) => {
      session.exitCode = code;
      session.signal = sig;
      session.finishedAt = Date.now();
    });

    if (signal) {
      const onAbort = () => this.stop(id);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    return this.snapshot(id)!;
  }

  write(id: string, input: string): void {
    const session = this.require(id);
    if (!session.process.stdin?.writable) throw new Error(`Terminal session is not writable: ${id}`);
    session.process.stdin.write(input);
  }

  stop(id: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
    const session = this.sessions.get(id);
    if (!session || !session.process.pid || session.finishedAt) return false;
    return session.process.kill(signal);
  }

  snapshot(id: string): TerminalSessionSnapshot | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    return {
      id,
      pid: session.process.pid,
      command: session.spec.command,
      cwd: session.spec.cwd,
      running: !session.finishedAt,
      exitCode: session.exitCode,
      signal: session.signal,
      stdout: session.stdout,
      stderr: session.stderr,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
    };
  }

  list(): TerminalSessionSnapshot[] {
    return [...this.sessions.keys()].sort().flatMap(id => {
      const snapshot = this.snapshot(id);
      return snapshot ? [snapshot] : [];
    });
  }

  remove(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (!session.finishedAt) this.stop(id);
    return this.sessions.delete(id);
  }

  stopAll(): void {
    for (const id of this.sessions.keys()) this.stop(id);
  }

  private require(id: string): RuntimeSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown terminal session: ${id}`);
    return session;
  }
}
