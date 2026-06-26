import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { buildAgentEnv } from '../security/AgentEnv.js';
import type { AgentMode } from '../agents/types.js';

export interface TerminalSession {
  id: string;
  agentId: string;
  command: string;
  args: string[];
  cwd: string;
  mode: AgentMode;
  status: 'starting' | 'running' | 'exited' | 'failed';
  stdout: string;
  stderr: string;
  exitCode?: number;
  pid?: number;
}

export interface TerminalEventMap {
  'session:started': { sessionId: string; agentId: string };
  'session:output': { sessionId: string; agentId: string; data: string };
  'session:stderr': { sessionId: string; agentId: string; data: string };
  'session:exited': { sessionId: string; agentId: string; exitCode: number };
  'session:failed': { sessionId: string; agentId: string; error: string };
}

export class TerminalSessionManager extends EventEmitter {
  private sessions: Map<string, TerminalSession> = new Map();
  private processes: Map<string, ChildProcess> = new Map();

  on<K extends keyof TerminalEventMap>(event: K, listener: (data: TerminalEventMap[K]) => void): this {
    return super.on(event, listener);
  }

  emit<K extends keyof TerminalEventMap>(event: K, data: TerminalEventMap[K]): boolean {
    return super.emit(event, data);
  }

  async createSession(
    agentId: string,
    command: string,
    args: string[],
    cwd: string,
    mode: AgentMode
  ): Promise<TerminalSession> {
    const id = `term_${agentId}_${Date.now()}`;
    const session: TerminalSession = {
      id,
      agentId,
      command,
      args,
      cwd,
      mode,
      status: 'starting',
      stdout: '',
      stderr: '',
    };

    this.sessions.set(id, session);
    this.emit('session:started', { sessionId: id, agentId });

    try {
      const env = buildAgentEnv(agentId, { EAMILOS_TERMINAL_SESSION: id });
      const proc = spawn(command, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        shell: process.platform === 'win32',
      });

      session.status = 'running';
      session.pid = proc.pid;
      this.processes.set(id, proc);

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        session.stdout += chunk;
        this.emit('session:output', { sessionId: id, agentId, data: chunk });
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        session.stderr += chunk;
        this.emit('session:stderr', { sessionId: id, agentId, data: chunk });
      });

      proc.on('error', (err) => {
        session.status = 'failed';
        this.emit('session:failed', { sessionId: id, agentId, error: err.message });
      });

      proc.on('exit', (code) => {
        session.status = 'exited';
        session.exitCode = code ?? undefined;
        this.processes.delete(id);
        this.emit('session:exited', { sessionId: id, agentId, exitCode: code ?? -1 });
      });
    } catch (err) {
      session.status = 'failed';
      this.emit('session:failed', { sessionId: id, agentId, error: (err as Error).message });
    }

    return session;
  }

  getSession(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  getSessionByAgent(agentId: string): TerminalSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.agentId === agentId) return session;
    }
    return undefined;
  }

  getAllSessions(): TerminalSession[] {
    return Array.from(this.sessions.values());
  }

  async stopSession(id: string): Promise<void> {
    const proc = this.processes.get(id);
    if (proc) {
      proc.stdin?.write('\x03');
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          try { proc.kill(); } catch { }
          resolve();
        }, 3000);
      });
    }
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.processes.keys());
    await Promise.allSettled(ids.map(id => this.stopSession(id)));
  }
}

let globalManager: TerminalSessionManager | null = null;

export function getTerminalSessionManager(): TerminalSessionManager {
  if (!globalManager) {
    globalManager = new TerminalSessionManager();
  }
  return globalManager;
}
