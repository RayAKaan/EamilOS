import { execSync } from 'child_process';
import { BaseAgent, crossSpawn, AgentCapability, AgentConfig, TerminalMessage, ToolCall } from './BaseAgent.js';
import { buildAgentEnv } from '../../core/security/AgentEnv.js';

export interface CodexCliResult {
  output: string;
  tools: ToolCall[];
  files: CreatedFile[];
}

export interface CreatedFile {
  path: string;
  content: string;
}

export class CodexCliAgent extends BaseAgent {
  readonly name = 'codex-cli';
  readonly command = 'codex';
  readonly installCheck = ['codex', '--version'];

  readonly capabilities: AgentCapability = {
    strengths: ['code-generation', 'file-editing', 'debugging'],
    weaknesses: ['web-research', 'multimodal'],
    supportedLanguages: ['typescript', 'javascript', 'python', 'rust', 'go', 'java'],
    maxContextTokens: 128000,
    tools: ['read', 'write', 'edit', 'search', 'bash'],
  };

  protected handleStdout(data: string): void {
    this.emit('output', { agentId: this.name, content: data });
  }

  protected handleStderr(data: string): void {
    this.emit('error', { agentId: this.name, error: data });
  }

  async send(message: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();
    return this.sendOneShot(message, id, startTime);
  }

  private async sendOneShot(prompt: string, id: string, startTime: number): Promise<TerminalMessage> {
    return new Promise((resolve) => {
      const args = ['exec', '--prompt', prompt];

      let output = '';
      let stderr = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        resolve(this.createMessage(id, 'codex-cli: timed out', '', [], { duration: Date.now() - startTime }));
      }, this.config.timeoutMs || 120000);

      const proc = crossSpawn(this.command, args, {
        cwd: this.config.workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildAgentEnv('codex-cli', { NO_COLOR: 'true', ...this.config.env }),
      });

      proc.on('error', async () => {
        if (!timedOut) {
          clearTimeout(timeout);
          resolve(this.createMessage(id, 'codex-cli: spawn failed', '', [], { duration: Date.now() - startTime }));
        }
      });

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        if (!timedOut) this.emitChunk(this.name, chunk);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (!timedOut) {
          clearTimeout(timeout);
          const finalOutput = output || stderr;
          if (code !== 0 && stderr) {
            resolve(this.createMessage(id, `codex-cli: exit code ${code}`, stderr, [], { duration: Date.now() - startTime }));
          } else {
            resolve(this.createMessage(id, finalOutput.trim(), '', [], { duration: Date.now() - startTime }));
          }
        }
      });
    });
  }
}
