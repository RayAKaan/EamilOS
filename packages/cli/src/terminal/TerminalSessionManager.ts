import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import { appendFileSync } from 'fs';
import type { AgentRequest } from '../core/agents/types.js';

export interface TerminalSessionRequest {
  agentId: string;
  callsign: string;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  logPath: string;
}

export interface TerminalSessionResult {
  agentId: string;
  callsign: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  logPath: string;
}

export class TerminalSessionManager extends EventEmitter {
  private processes = new Map<string, ChildProcess>();

  async start(request: TerminalSessionRequest): Promise<TerminalSessionResult> {
    const startTime = Date.now();
    const stdout: string[] = [];
    const stderr: string[] = [];

    return new Promise<TerminalSessionResult>((resolve) => {
      const proc = spawn(request.command, request.args, {
        cwd: request.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.processes.set(request.callsign, proc);

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout.push(chunk);
        appendFileSync(request.logPath, chunk);
        this.emit('output', { agentId: request.agentId, callsign: request.callsign, content: chunk });
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr.push(chunk);
        appendFileSync(request.logPath, chunk);
        this.emit('output', { agentId: request.agentId, callsign: request.callsign, content: chunk });
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
      }, request.timeoutMs);

      proc.on('close', (exitCode, signal) => {
        clearTimeout(timer);
        this.processes.delete(request.callsign);
        const durationMs = Date.now() - startTime;
        resolve({
          agentId: request.agentId,
          callsign: request.callsign,
          exitCode,
          signal,
          stdout: stdout.join(''),
          stderr: stderr.join(''),
          durationMs,
          logPath: request.logPath,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.processes.delete(request.callsign);
        this.emit('error', { agentId: request.agentId, callsign: request.callsign, error: err.message });
      });
    });
  }

  stop(callsign: string): void {
    const proc = this.processes.get(callsign);
    if (proc) {
      proc.kill('SIGTERM');
    }
  }

  stopAll(): void {
    for (const callsign of this.processes.keys()) {
      this.stop(callsign);
    }
  }

  getActiveSessions(): string[] {
    return Array.from(this.processes.keys());
  }
}

export interface EamilOSAgentCommandProvider {
  getCommand(request: AgentRequest): { command: string; args: string[] };
}
