import { execSync } from 'child_process';
import { BaseAgent, crossSpawn, AgentCapability, AgentConfig, TerminalMessage, ToolCall } from './BaseAgent.js';
import { getProviderManager } from '../../core/provider-manager.js';

export interface GooseResult {
  output: string;
  tools: ToolCall[];
  files: CreatedFile[];
}

export interface CreatedFile {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  lines?: number;
}

export class GooseAgent extends BaseAgent {
  readonly name = 'goose';
  readonly command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  readonly installCheck = [this.command, '@block/goose', '--version'];

  readonly capabilities: AgentCapability = {
    strengths: ['autonomous-automation', 'tool-orchestration', 'developer-workflows', 'shell-automation'],
    weaknesses: ['local-setup-dependency', 'smaller-ecosystem', 'limited-language-support'],
    supportedLanguages: ['python', 'typescript', 'javascript', 'go', 'rust', 'bash'],
    maxContextTokens: 128000,
    tools: ['bash', 'read', 'write', 'edit', 'grep', 'git'],
  };

  private static installChecked = false;
  private static isInstalled = false;

  constructor(config: AgentConfig = {}) {
    super(config);
    this.config = {
      timeoutMs: 120000,
      ...config,
    };
    if (config.timeoutMs !== undefined) this.config.timeoutMs = config.timeoutMs;
    if (config.workingDir !== undefined) this.config.workingDir = config.workingDir;
    if (config.env !== undefined) this.config.env = config.env;
  }

  async checkInstalled(): Promise<{ available: boolean; version?: string; error?: string }> {
    if (GooseAgent.installChecked) {
      return { available: GooseAgent.isInstalled, version: GooseAgent.isInstalled ? 'CLI' : undefined };
    }
    GooseAgent.installChecked = true;
    try {
      execSync('npx --no-install @block/goose --version 2>&1', { timeout: 2000, stdio: 'pipe' });
      GooseAgent.isInstalled = true;
      return { available: true, version: 'CLI' };
    } catch {
      try {
        execSync('goose --version 2>&1', { timeout: 2000, stdio: 'pipe' });
        GooseAgent.isInstalled = true;
        return { available: true, version: 'CLI' };
      } catch {
        GooseAgent.isInstalled = false;
        return { available: false, version: undefined, error: 'goose not installed. Run: npm install -g @block/goose' };
      }
    }
  }

  async send(message: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();
    return await this.sendOneShot(message, id, startTime);
  }

  private sendOneShot(prompt: string, id: string, startTime: number): Promise<TerminalMessage> {
    return new Promise((resolve) => {
      let finalCmd: string;
      let args: string[];

      try {
        execSync('goose --version 2>&1', { timeout: 1000, stdio: 'pipe' });
        finalCmd = 'goose';
        args = ['run', prompt];
      } catch {
        finalCmd = this.command;
        args = ['--yes', '@block/goose', 'run', prompt];
      }

      let output = '';
      let stderr = '';
      let timedOut = false;

      const proc = crossSpawn(finalCmd, args, {
        cwd: this.config.workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: 'true', ...this.config.env },
      });

      proc.on('error', async () => {
        if (!timedOut) { clearTimeout(timeout); resolve(await this.executeKernelFallback(prompt, id, startTime)); }
      });

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        this.emitChunk('goose', chunk);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        this.emitChunk('goose', chunk);
      });

      const timeout = setTimeout(async () => {
        timedOut = true;
        try { proc.kill(); } catch {}
        const timeoutSec = Math.round((this.config.timeoutMs ?? 120000) / 1000);
        resolve(this.createMessage(id, `Agent timed out after ${timeoutSec}s`, stderr || 'timeout', [], { duration: Date.now() - startTime }));
      }, this.config.timeoutMs ?? 120000);

      proc.on('close', async (code) => {
        if (timedOut) return;
        clearTimeout(timeout);
        const duration = Date.now() - startTime;

        if (code === 0 && output.trim()) {
          const parsed = this.parseResponse(output.trim(), id);
          resolve(this.createMessage(
            id,
            parsed.output,
            output,
            parsed.tools,
            { exitCode: code, duration, files: parsed.files }
          ));
        } else {
          const errMsg = stderr.trim() || `goose exited with code ${code}`;
          resolve(this.createMessage(id, `Goose failed: ${errMsg}`, output || errMsg, [], { duration, exitCode: code }));
        }
      });
    });
  }

  private async executeKernelFallback(prompt: string, id: string, startTime: number): Promise<TerminalMessage> {
    const duration = Date.now() - startTime;
    try {
      const pm = getProviderManager();
      const res = await pm.chat([{ role: 'user', content: prompt }]);
      const parsed = this.parseResponse(res.content, id);
      return this.createMessage(id, parsed.output || res.content, res.content, parsed.tools, { duration, files: parsed.files });
    } catch {
      return this.createMessage(id, 'EamilOS: no AI provider available. Install goose: npm install -g @block/goose', '', [], { duration, files: [] });
    }
  }

  private parseResponse(raw: string, _id: string): GooseResult {
    let output = '';
    const tools: ToolCall[] = [];
    const files: CreatedFile[] = [];

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.type === 'text' && parsed.content) {
          output += parsed.content;
        } else if (parsed.type === 'tool_call' || parsed.type === 'tool_use') {
          tools.push({
            name: parsed.tool || parsed.name || 'unknown',
            args: parsed.input || parsed.arguments || {},
            result: parsed.result,
            success: parsed.success !== false,
          });
        } else if (parsed.type === 'file' || parsed.file) {
          files.push({
            path: parsed.path || parsed.file || 'unknown',
            action: parsed.action || 'created',
            lines: parsed.lines,
          });
        } else if (parsed.type === 'error') {
          output += `\n[ERROR] ${parsed.message || parsed.content || ''}\n`;
        }
      } catch {
        if (!output) {
          output = trimmed;
        } else {
          output += '\n' + trimmed;
        }
      }
    }

    if (!output) {
      output = raw;
    }

    return { output: output.trim(), tools, files };
  }

  handleStdout(_data: string): void {}
  handleStderr(_data: string): void {}
}
