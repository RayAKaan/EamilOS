import { spawn, execSync, ChildProcess } from 'child_process';
import { BaseAgent, crossSpawn, AgentCapability, AgentConfig, TerminalMessage, ToolCall } from './BaseAgent.js';
import { getProviderManager } from '../../core/provider-manager.js';

export interface OpenCodeResult {
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

export class OpenCodeAgent extends BaseAgent {
  readonly name = 'opencode';
  readonly command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  readonly installCheck = [this.command, 'opencode-ai', '--version'];

  readonly capabilities: AgentCapability = {
    strengths: ['multi-model', '75+ providers', 'code-generation', 'refactoring', 'flexible-routing', 'open-source'],
    weaknesses: ['one-shot-at-a-time', 'no-built-in-context-sharing', 'slower-cold-start'],
    supportedLanguages: ['python', 'typescript', 'javascript', 'go', 'rust', 'java', 'cpp', 'csharp', 'ruby', 'php', 'swift', 'kotlin'],
    maxContextTokens: 200000,
    tools: ['bash', 'read', 'write', 'edit', 'grep', 'git', 'web-search', 'browser'],
  };

  private serverPort = 4096;
  private serverProcess: ChildProcess | null = null;

  private static serverRunning = false;
  private static serverUrl: string | null = null;

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

  private checkedInstalled = false;
  private isInstalledBinary = false;

  async checkInstalled(): Promise<{ available: boolean; version?: string; error?: string }> {
    if (this.checkedInstalled) {
      return { available: this.isInstalledBinary, version: this.isInstalledBinary ? 'CLI' : undefined };
    }
    this.checkedInstalled = true;
    try {
      execSync('npx --no-install opencode-ai --version 2>&1', { timeout: 2000, stdio: 'pipe' });
      this.isInstalledBinary = true;
      return { available: true, version: 'CLI' };
    } catch {
      this.isInstalledBinary = false;
      return { available: false, version: undefined, error: 'opencode-ai not installed. Run: npm install -g opencode-ai' };
    }
  }

  async startServer(port = 4096): Promise<void> {
    if (OpenCodeAgent.serverRunning) {
      return;
    }

    this.serverPort = port;
    OpenCodeAgent.serverUrl = `http://127.0.0.1:${port}`;

    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        NO_COLOR: 'true',
        ...this.config.env,
      };

      this.serverProcess = crossSpawn(this.command, [
        'opencode-ai', 'serve',
        '--port', String(port),
        '--hostname', '127.0.0.1',
      ], {
        cwd: this.config.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });

      let startupOutput = '';
      let resolved = false;

      const resolveOnce = () => {
        if (!resolved) {
          resolved = true;
          OpenCodeAgent.serverRunning = true;
          setTimeout(resolve, 500);
        }
      };

      this.serverProcess.stdout?.on('data', (data: Buffer) => {
        startupOutput += data.toString();
        if (
          startupOutput.includes('listening') ||
          startupOutput.includes('started') ||
          startupOutput.includes(`:${port}`) ||
          startupOutput.includes('127.0.0.1') ||
          startupOutput.includes('Server running')
        ) {
          resolveOnce();
        }
      });

      this.serverProcess.stderr?.on('data', (data: Buffer) => {
        startupOutput += data.toString();
        if (
          startupOutput.includes('listening') ||
          startupOutput.includes(`:${port}`)
        ) {
          resolveOnce();
        }
      });

      this.serverProcess.on('error', (err) => {
        OpenCodeAgent.serverRunning = false;
        if (!resolved) reject(new Error(`Server error: ${err.message}`));
      });

      this.serverProcess.on('exit', (code) => {
        OpenCodeAgent.serverRunning = false;
        if (!resolved && code !== 0) {
          reject(new Error(`Server exited with code ${code}`));
        }
      });

      setTimeout(() => {
        if (!resolved) {
          if (startupOutput.length > 0 && !startupOutput.includes('error')) {
            resolveOnce();
          } else {
            reject(new Error('Server startup timeout — no response after 15s'));
          }
        }
      }, 15000);
    });
  }

  async stopServer(): Promise<void> {
    if (this.serverProcess) {
      try {
        this.serverProcess.kill();
      } catch {}
      this.serverProcess = null;
      OpenCodeAgent.serverRunning = false;
      OpenCodeAgent.serverUrl = null;
    }
  }

  async send(message: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();
    return await this.sendOneShot(message, id, startTime);
  }

  private async callServer(prompt: string): Promise<string> {
    if (!OpenCodeAgent.serverUrl) {
      throw new Error('Server not running');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${OpenCodeAgent.serverUrl}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model || 'anthropic/claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        }),
        signal: controller.signal,
      });

      return response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  private sendOneShot(prompt: string, id: string, startTime: number): Promise<TerminalMessage> {
    return new Promise((resolve) => {
      const args = [
        'run', prompt,
      ];

      if (this.config.model) {
        args.push('--model', this.config.model);
      }

      let output = '';
      let stderr = '';
      let timedOut = false;

      const proc = crossSpawn(this.command, ['--yes', 'opencode-ai', ...args], {
        cwd: this.config.workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NO_COLOR: 'true',
          ...this.config.env,
        },
      });

      proc.on('error', async (err) => {
        if (!timedOut) {
          clearTimeout(timeout);
          resolve(await this.executeKernelFallback(prompt, id, startTime));
        }
      });

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        this.emitChunk('opencode', chunk);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        this.emitChunk('opencode', chunk);
      });

      const timeout = setTimeout(async () => {
        timedOut = true;
        try { proc.kill(); } catch {}
        resolve(this.createMessage(id, 'Agent timed out after 15s', stderr || 'timeout', [], { duration: Date.now() - startTime }));
      }, 15000);

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
            { exitCode: code, duration, files: parsed.files, stats: parsed.stats }
          ));
        } else {
          const errMsg = stderr.trim() || `opencode-ai exited with code ${code}`;
          resolve(this.createMessage(id, `opencode-ai failed: ${errMsg}`, output || errMsg, [], { duration, exitCode: code }));
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
      return this.createMessage(id, 'EamilOS: no AI provider available. Configure a provider or install opencode-ai.', '', [], { duration, files: [] });
    }
  }

  private parseResponse(raw: string, _id: string): OpenCodeResult {
    let output = '';
    const tools: ToolCall[] = [];
    const files: CreatedFile[] = [];
    const stats: OpenCodeResult['stats'] = {};

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
        } else if (parsed.type === 'step_finish') {
          if (parsed.part?.tokens?.total) {
            stats.tokens = parsed.part.tokens.total;
          }
          if (parsed.part?.cost) {
            stats.cost = parsed.part.cost;
          }
          if (parsed.part?.durationMs) {
            stats.durationMs = parsed.part.durationMs;
          }
        } else if (parsed.type === 'tool_use') {
          tools.push({
            name: parsed.part?.tool || parsed.part?.name || parsed.tool || 'unknown',
            args: parsed.part?.input || parsed.input || {},
            success: true,
          });
        } else if (parsed.type === 'tool_result') {
          const lastTool = tools[tools.length - 1];
          if (lastTool && parsed.result) {
            lastTool.result = typeof parsed.result === 'string'
              ? parsed.result
              : JSON.stringify(parsed.result);
          }
        } else if (parsed.type === 'file_write' || parsed.type === 'file_created' || parsed.type === 'file_modified') {
          files.push({
            path: parsed.part?.path || parsed.part?.file || parsed.path || 'unknown',
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
        /"([^\s"]+\.(ts|js|tsx|jsx|py|go|rs|java))"/gi,
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

    return { output: output.trim(), tools, files, stats };
  }

  async terminate(): Promise<void> {
    await this.stopServer();
  }

  handleStdout(_data: string): void {}
  handleStderr(_data: string): void {}
}
