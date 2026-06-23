import { spawn, execSync } from 'child_process';
import { BaseAgent, crossSpawn, AgentCapability, AgentConfig, TerminalMessage, ToolCall } from './BaseAgent.js';

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
}

export class OpenCodeAgent extends BaseAgent {
  readonly name = 'opencode';
  readonly command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  readonly installCheck = [this.command, 'opencode-ai', '--version'];

  readonly capabilities: AgentCapability = {
    strengths: ['multi-model', '75+ providers', 'code-generation', 'refactoring', 'flexible-routing'],
    weaknesses: ['limited-agentic', 'one-shot-at-a-time', 'no-built-in-context-sharing'],
    supportedLanguages: ['python', 'typescript', 'javascript', 'go', 'rust', 'java', 'cpp', 'csharp', 'ruby', 'php'],
    maxContextTokens: 200000,
    tools: ['bash', 'read', 'write', 'edit', 'grep', 'git', 'web-search'],
  };

  private serverPort = 4096;
  private serverProcess: ReturnType<typeof spawn> | null = null;

  constructor(config: AgentConfig = {}) {
    super(config);
    this.config = {
      timeoutMs: 120000,
    };
    if (config.timeoutMs !== undefined) this.config.timeoutMs = config.timeoutMs;
    if (config.workingDir !== undefined) this.config.workingDir = config.workingDir;
    if (config.env !== undefined) this.config.env = config.env;
    if (config.model !== undefined) this.config.model = config.model;
  }

  async checkInstalled(): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      const result = execSync('npx opencode-ai --version 2>&1', { timeout: 30000, encoding: 'utf-8' });
      const version = result.trim().split('\n').filter(l => l.includes('.'))[0] || result.trim();
      return { available: true, version };
    } catch (err) {
      return { available: false, error: (err as Error).message };
    }
  }

  async startServer(port = 4096): Promise<void> {
    this.serverPort = port;

    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        NO_COLOR: 'true',
        ...this.config.env,
      };

      this.serverProcess = crossSpawn(this.command, ['opencode-ai', 'serve', '--port', String(port), '--hostname', '127.0.0.1'], {
        cwd: this.config.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });

      let startupOutput = '';

      this.serverProcess.stdout?.on('data', (data: Buffer) => {
        startupOutput += data.toString();
        if (startupOutput.includes('listening') || startupOutput.includes('started') || startupOutput.includes(port.toString())) {
          setTimeout(resolve, 1000);
        }
      });

      this.serverProcess.stderr?.on('data', (data: Buffer) => {
        startupOutput += data.toString();
      });

      this.serverProcess.on('error', reject);
      this.serverProcess.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Server exited with code ${code}`));
      });

      setTimeout(() => {
        if (!this.serverProcess) reject(new Error('Server startup timeout'));
      }, 15000);
    });
  }

  async send(message: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();

    try {
      const response = await this.callServer(message);
      const duration = Date.now() - startTime;
      const parsed = this.parseResponse(response, id);
      return this.createMessage(id, parsed.output, response, parsed.tools, { duration, files: parsed.files, stats: parsed.stats });
    } catch {
      return this.sendOneShot(message, id);
    }
  }

  private async callServer(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(`http://127.0.0.1:${this.serverPort}/v1/chat`, {
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

  private async sendOneShot(prompt: string, id: string): Promise<TerminalMessage> {
    return new Promise((resolve, reject) => {
      const args = ['run', '--format', 'json'];

      if (this.config.model) {
        args.push('--model', this.config.model);
      }

      let output = '';
      let stderr = '';

      const proc = crossSpawn(this.command, ['opencode-ai', ...args], {
        cwd: this.config.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: 'true', ...this.config.env },
      });

      proc.stdin?.write(prompt);
      proc.stdin?.end();

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Process error: ${err.message}`));
      });

      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        try { proc.kill(); } catch {}
        reject(new Error(`Timeout after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      proc.on('close', (code) => {
        if (timedOut) return;
        clearTimeout(timeout);
        const duration = Date.now() - parseInt(id.split('_')[2] || '0');

        if (code === 0 && output.trim()) {
          const parsed = this.parseResponse(output.trim(), id);
          resolve(this.createMessage(id, parsed.output, output, parsed.tools, { exitCode: code, duration, files: parsed.files, stats: parsed.stats }));
        } else if (stderr) {
          const parsed = this.parseResponse(stderr.trim(), id);
          resolve(this.createMessage(id, parsed.output || `Error: ${stderr}`, stderr, [], { exitCode: code, error: stderr.slice(0, 500) }));
        } else {
          resolve(this.createMessage(id, output.trim() || 'No output', output, [], { exitCode: code }));
        }
      });
    });
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
          if (parsed.part?.tokens) {
            stats.tokens = parsed.part.tokens.total;
            stats.cost = parsed.part.cost;
          }
        } else if (parsed.type === 'tool_use') {
          tools.push({
            name: parsed.part?.tool || parsed.part?.name || 'unknown',
            args: parsed.part?.input || {},
            success: true,
          });
        } else if (parsed.type === 'file_write' || parsed.type === 'file_created') {
          files.push({
            path: parsed.part?.path || parsed.part?.file || 'unknown',
            action: 'created',
          });
        }
      } catch {
        if (!output) output = trimmed;
      }
    }

    if (!output) {
      output = raw;
      const fileRefPattern = /(?:created|modified|wrote|saved)\s+[`"']?([^\s`"'\n]+(?:\.\w+)?)[`"']?/gi;
      const refMatches = output.matchAll(fileRefPattern);
      for (const m of refMatches) {
        if (!files.find(f => f.path === m[1])) {
          files.push({ path: m[1], action: 'created' });
        }
      }
    }

    return { output: output.trim(), tools, files, stats };
  }

  async terminate(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill('SIGTERM');
      this.serverProcess = null;
    }
  }

  handleStdout(_data: string): void {}
  handleStderr(_data: string): void {}
}
