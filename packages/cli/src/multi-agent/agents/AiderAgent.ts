import { execSync } from 'child_process';
import { BaseAgent, crossSpawn, AgentCapability, AgentConfig, TerminalMessage, ToolCall } from './BaseAgent.js';
import { getProviderManager } from '../../core/provider-manager.js';

export interface AiderResult {
  output: string;
  tools: ToolCall[];
  files: CreatedFile[];
  stats?: {
    tokens?: number;
    cost?: number;
    durationMs?: number;
  };
}

export interface CreatedFile {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  lines?: number;
  content?: string;
}

export class AiderAgent extends BaseAgent {
  readonly name = 'aider';
  readonly command = 'aider';
  readonly installCheck = ['aider', '--version'];

  readonly capabilities: AgentCapability = {
    strengths: ['pair-programming', 'git-integration', 'multi-file-edit', 'surgical-edits', 'ast-aware'],
    weaknesses: ['requires-git-repo', 'terminal-bound', 'python-dependency', 'no-built-in-web-search'],
    supportedLanguages: ['python', 'typescript', 'javascript', 'go', 'rust', 'java', 'cpp', 'csharp', 'ruby', 'php'],
    maxContextTokens: 128000,
    tools: ['git', 'edit', 'read', 'write', 'grep'],
  };

  private static installChecked = false;
  private static isInstalled = false;

  constructor(config: AgentConfig = {}) {
    super(config);
    this.config = {
      timeoutMs: 180000,
      ...config,
    };
    if (config.timeoutMs !== undefined) this.config.timeoutMs = config.timeoutMs;
    if (config.workingDir !== undefined) this.config.workingDir = config.workingDir;
    if (config.env !== undefined) this.config.env = config.env;
    if (config.model !== undefined) this.config.model = config.model;
  }

  async checkInstalled(): Promise<{ available: boolean; version?: string; error?: string }> {
    if (AiderAgent.installChecked) {
      return { available: AiderAgent.isInstalled, version: AiderAgent.isInstalled ? 'CLI' : undefined };
    }
    AiderAgent.installChecked = true;
    try {
      execSync('aider --version 2>&1', { timeout: 2000, stdio: 'pipe' });
      AiderAgent.isInstalled = true;
      return { available: true, version: 'CLI' };
    } catch {
      AiderAgent.isInstalled = false;
      return { available: false, version: undefined, error: 'aider not installed. Run: pip install aider-chat' };
    }
  }

  async send(message: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();
    return await this.sendOneShot(message, id, startTime);
  }

  private sendOneShot(prompt: string, id: string, startTime: number): Promise<TerminalMessage> {
    return new Promise((resolve) => {
      const args = [
        '--message', prompt,
        '--no-suggest-shell-commands',
        '--yes',
      ];

      if (this.config.model) {
        args.push('--model', this.config.model);
      }

      let output = '';
      let stderr = '';
      let timedOut = false;

      const proc = crossSpawn(this.command, args, {
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
        this.emitChunk('aider', chunk);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        this.emitChunk('aider', chunk);
      });

      const timeout = setTimeout(async () => {
        timedOut = true;
        try { proc.kill(); } catch {}
        const timeoutSec = Math.round((this.config.timeoutMs ?? 180000) / 1000);
        resolve(this.createMessage(id, `Agent timed out after ${timeoutSec}s`, stderr || 'timeout', [], { duration: Date.now() - startTime }));
      }, this.config.timeoutMs ?? 180000);

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
          const errMsg = stderr.trim() || `aider exited with code ${code}`;
          resolve(this.createMessage(id, `Aider failed: ${errMsg}`, output || errMsg, [], { duration, exitCode: code }));
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
      return this.createMessage(id, 'EamilOS: no AI provider available. Install aider: pip install aider-chat', '', [], { duration, files: [] });
    }
  }

  private parseResponse(raw: string, _id: string): AiderResult {
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
        } else if (parsed.type === 'tool_use') {
          tools.push({
            name: parsed.tool || parsed.name || 'unknown',
            args: parsed.input || {},
            success: true,
          });
        } else if (parsed.type === 'file' || parsed.path) {
          files.push({
            path: parsed.path || 'unknown',
            action: parsed.action || 'modified',
            lines: parsed.lines,
          });
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

    const aiderFilePattern = /(?:^|\s)([^\s]+\.(py|ts|js|tsx|jsx|go|rs|java|cpp|c|h|rb|php))\s/g;
    const aiderMatches = output.matchAll(aiderFilePattern);
    for (const m of aiderMatches) {
      const path = m[1];
      if (path && !path.includes('node_modules') && !files.find(f => f.path === path)) {
        files.push({ path, action: 'modified' });
      }
    }

    return { output: output.trim(), tools, files };
  }

  handleStdout(_data: string): void {}
  handleStderr(_data: string): void {}
}
