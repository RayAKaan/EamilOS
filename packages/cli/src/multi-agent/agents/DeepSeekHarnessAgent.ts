import { BaseAgent, crossSpawn, type AgentConfig, type AgentCapability, type TerminalMessage } from './BaseAgent.js';
import { buildAgentEnv } from '../../core/security/AgentEnv.js';

interface DeepSeekJsonEvent {
  type?: string;
  session?: string;
  text?: string;
  thinking?: string;
  tool_call?: Record<string, unknown>;
  tool_result?: Record<string, unknown>;
  status?: string;
  final?: string;
  error?: string;
}

export class DeepSeekHarnessAgent extends BaseAgent {
  readonly name = 'deepseek-harness';
  readonly command = process.platform === 'win32' ? 'dsh.cmd' : 'dsh';
  readonly installCheck = [this.command, '--help'];

  readonly capabilities: AgentCapability = {
    strengths: ['agent-loop', 'tool-orchestration', 'durable-sessions', 'model-routing', 'research', 'coding'],
    weaknesses: ['one-shot-headless-boundary', 'requires-deepseek-configuration'],
    supportedLanguages: ['typescript', 'javascript', 'python', 'rust', 'go', 'java'],
    maxContextTokens: 128000,
    tools: ['filesystem', 'bash', 'web', 'subagents', 'mcp'],
  };

  private sessionIdentity?: string;

  constructor(config: AgentConfig = {}) {
    super({ timeoutMs: 240000, ...config });
  }

  async send(message: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();

    return new Promise((resolve) => {
      let settled = false;
      let output = '';
      let stderr = '';
      let sessionId = this.sessionIdentity;

      const finish = (msg: TerminalMessage) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(msg);
      };

      const args = [
        '--profile', 'headless',
        '--json',
        ...(sessionId ? ['--session-id', sessionId] : []),
        message,
      ];

      const proc = crossSpawn(this.command, args, {
        cwd: this.config.workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildAgentEnv('deepseek-harness', { NO_COLOR: 'true', ...this.config.env }),
      });
      this.trackProcess(proc);

      const timeout = setTimeout(() => {
        void this.terminate();
        finish(this.createMessage(
          id,
          `DeepSeek Harness timed out after ${Math.round((this.config.timeoutMs ?? 240000) / 1000)}s`,
          stderr || output,
          [],
          { duration: Date.now() - startTime, provider: 'deepseek-harness' },
        ));
      }, this.config.timeoutMs ?? 240000);

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        for (const line of chunk.split(/\r?\n/)) {
          if (!line.trim()) continue;
          let event: DeepSeekJsonEvent;
          try {
            event = JSON.parse(line) as DeepSeekJsonEvent;
          } catch {
            continue;
          }

          if (event.type === 'session' && event.session) {
            sessionId = event.session;
            this.sessionIdentity = event.session;
          }

          const text = event.text ?? event.thinking ?? event.final;
          if (text) {
            this.emitChunk(this.name, text);
          }
          if (event.tool_call) {
            this.emitChunk(this.name, `\n[tool] ${JSON.stringify(event.tool_call)}\n`);
          }
          if (event.error) {
            stderr += event.error;
          }
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.once('error', (error) => {
        if (settled) return;
        finish(this.createMessage(
          id,
          `DeepSeek Harness failed to start: ${error.message}`,
          stderr,
          [],
          { duration: Date.now() - startTime, provider: 'deepseek-harness' },
        ));
      });

      proc.once('close', (code) => {
        if (settled) return;
        const duration = Date.now() - startTime;
        if (code === 0) {
          let finalText = '';
          for (const line of output.split(/\r?\n/)) {
            try {
              const event = JSON.parse(line) as DeepSeekJsonEvent;
              if (event.type === 'final') finalText = event.text ?? event.final ?? '';
            } catch {}
          }
          finish(this.createMessage(id, finalText.trim() || output.trim(), output, [], {
            exitCode: code,
            duration,
            provider: 'deepseek-harness',
            sessionId,
          }));
        } else {
          finish(this.createMessage(
            id,
            stderr.trim() || `DeepSeek Harness exited with code ${code ?? 'unknown'}`,
            output || stderr,
            [],
            { exitCode: code ?? -1, duration, provider: 'deepseek-harness', sessionId },
          ));
        }
      });
    });
  }

  handleStdout(_data: string): void {}
  handleStderr(_data: string): void {}
}
