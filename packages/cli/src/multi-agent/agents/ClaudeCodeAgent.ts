import { execSync } from 'child_process';
import { BaseAgent, crossSpawn, AgentCapability, AgentConfig, TerminalMessage, ToolCall } from './BaseAgent.js';
import { getProviderManager } from '../../core/provider-manager.js';

export interface ClaudeCodeResult {
  output: string;
  tools: ToolCall[];
  files: CreatedFile[];
}

export interface CreatedFile {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  lines?: number;
  content?: string;
}

export class ClaudeCodeAgent extends BaseAgent {
  readonly name = 'claude-code';
  readonly command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  readonly installCheck = [this.command, '@anthropic-ai/claude-code', '--version'];

  readonly capabilities: AgentCapability = {
    strengths: ['autonomous-coding', 'refactoring', 'deep-reasoning', 'terminal-execution', 'architectural-design'],
    weaknesses: ['api-rate-limits', 'shorter-native-context', 'requires-anthropic-auth'],
    supportedLanguages: ['python', 'typescript', 'javascript', 'go', 'rust', 'java', 'cpp', 'csharp', 'ruby', 'php'],
    maxContextTokens: 200000,
    tools: ['bash', 'read', 'write', 'edit', 'grep', 'git', 'web-search', 'browser'],
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
    if (ClaudeCodeAgent.installChecked) {
      return { available: ClaudeCodeAgent.isInstalled, version: ClaudeCodeAgent.isInstalled ? 'CLI' : undefined };
    }
    ClaudeCodeAgent.installChecked = true;
    try {
      execSync('npx --no-install @anthropic-ai/claude-code --version 2>&1', { timeout: 2000, stdio: 'pipe' });
      ClaudeCodeAgent.isInstalled = true;
      return { available: true, version: 'CLI' };
    } catch {
      ClaudeCodeAgent.isInstalled = false;
      return { available: false, version: undefined, error: '@anthropic-ai/claude-code not installed. Run: npm install -g @anthropic-ai/claude-code' };
    }
  }

  async send(message: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();
    return await this.sendOneShot(message, id, startTime);
  }

  private sendOneShot(prompt: string, id: string, startTime: number): Promise<TerminalMessage> {
    return new Promise((resolve) => {
      const args = ['--print', prompt];

      let output = '';
      let stderr = '';
      let timedOut = false;

      const proc = crossSpawn(this.command, ['--yes', '@anthropic-ai/claude-code', ...args], {
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
        this.emitChunk('claude-code', chunk);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        this.emitChunk('claude-code', chunk);
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
          const errMsg = stderr.trim() || `@anthropic-ai/claude-code exited with code ${code}`;
          resolve(this.createMessage(id, `Claude Code failed: ${errMsg}`, output || errMsg, [], { duration, exitCode: code }));
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
      return this.createMessage(id, 'EamilOS: no AI provider available. Configure an Anthropic provider or install @anthropic-ai/claude-code.', '', [], { duration, files: [] });
    }
  }

  private parseResponse(raw: string, _id: string): ClaudeCodeResult {
    let output = '';
    const tools: ToolCall[] = [];
    const files: CreatedFile[] = [];

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed);

        if (parsed.type === 'text' && parsed.part?.text) {
          output += parsed.part.text;
        } else if (parsed.type === 'content' && parsed.part?.content) {
          output += parsed.part.content;
        } else if (parsed.type === 'step_start' && parsed.part?.name) {
          output += `\n[${parsed.part.name}]\n`;
        } else if (parsed.type === 'tool_use') {
          tools.push({
            name: parsed.part?.tool || parsed.part?.name || 'unknown',
            args: parsed.part?.input || {},
            success: true,
          });
        } else if (parsed.type === 'tool_result') {
          const lastTool = tools[tools.length - 1];
          if (lastTool && parsed.result) {
            lastTool.result = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
          }
        } else if (parsed.type === 'file_write' || parsed.type === 'file_created' || parsed.type === 'file_modified') {
          files.push({
            path: parsed.part?.path || parsed.path || 'unknown',
            action: parsed.type === 'file_modified' ? 'modified' : 'created',
            lines: parsed.part?.lines || parsed.lines,
          });
        } else if (parsed.type === 'error') {
          output += `\n[ERROR] ${parsed.message || JSON.stringify(parsed)}\n`;
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

    if (files.length === 0) {
      const patterns = [
        /(?:created|modified|wrote|saved)\s+[`"']?([^\s`"'\n]+(?:\.\w+)?)[`"']?/gi,
        /`([^\s`]+\.(ts|js|tsx|jsx|py|go|rs|java|cpp|c|h))`/gi,
      ];

      for (const pattern of patterns) {
        const matches = output.matchAll(pattern);
        for (const m of matches) {
          const path = m[1];
          if (path && !path.includes('node_modules') && !files.find(f => f.path === path)) {
            files.push({ path, action: 'created' });
          }
        }
      }
    }

    return { output: output.trim(), tools, files };
  }

  handleStdout(_data: string): void {}
  handleStderr(_data: string): void {}
}
