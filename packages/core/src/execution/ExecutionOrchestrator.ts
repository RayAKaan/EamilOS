import { spawn } from 'child_process';
import type {
  ITerminalExecutionProtocol,
  TerminalConfig,
  CommandResult,
} from '../protocols/execution-protocol.js';

export class ExecutionOrchestrator implements ITerminalExecutionProtocol {
  private readonly sessions: Map<string, TerminalConfig> = new Map();

  async spawn(sessionId: string, config: TerminalConfig): Promise<string> {
    this.sessions.set(sessionId, config);
    return sessionId;
  }

  async execute(sessionId: string, command: string, timeout = 30_000): Promise<CommandResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const startedAt = Date.now();
    return new Promise<CommandResult>((resolve) => {
      const shell = session.shell || (process.platform === 'win32' ? 'powershell.exe' : '/bin/sh');
      const shellArg = process.platform === 'win32' ? '-Command' : '-lc';
      const child = spawn(shell, [shellArg, command], {
        cwd: session.cwd,
        env: { ...process.env, ...(session.env || {}) },
      });

      let stdout = '';
      let stderr = '';
      let finished = false;

      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        child.kill('SIGTERM');
        resolve({
          success: false,
          output: stdout,
          exitCode: -1,
          error: `Command timed out after ${timeout}ms: ${stderr}`.trim(),
          durationMs: Date.now() - startedAt,
        });
      }, timeout);

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += String(chunk);
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk);
      });

      child.on('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({
          success: code === 0,
          output: stdout,
          exitCode: code ?? -1,
          error: stderr || undefined,
          durationMs: Date.now() - startedAt,
        });
      });

      child.on('error', (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({
          success: false,
          output: stdout,
          exitCode: -1,
          error: error.message,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }

  async executeParallel(commands: Array<{ sessionId: string; command: string }>): Promise<Map<string, CommandResult>> {
    const results = await Promise.all(
      commands.map(async (item) => ({
        key: `${item.sessionId}:${item.command}`,
        result: await this.execute(item.sessionId, item.command),
      }))
    );

    return new Map(results.map((item) => [item.key, item.result]));
  }

  cleanup(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
