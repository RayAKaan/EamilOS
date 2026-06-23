import { execSync } from 'child_process';
import { BaseAgent, crossSpawn, AgentCapability, AgentConfig, TerminalMessage, ToolCall } from './BaseAgent.js';

export interface GeminiResult {
  response: string;
  stats: {
    models?: Record<string, { api?: unknown; tokens?: unknown }>;
    tools?: {
      totalCalls: number;
      totalSuccess: number;
      totalFail: number;
      totalDurationMs: number;
      totalDecisions?: Record<string, number>;
    };
    files?: {
      totalLinesAdded: number;
      totalLinesRemoved: number;
    };
  };
  tools: ToolCall[];
  files: CreatedFile[];
}

export interface CreatedFile {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  lines?: number;
}

export class GeminiCliAgent extends BaseAgent {
  readonly name = 'gemini-cli';
  readonly command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  readonly installCheck = [this.command, '@google/gemini-cli', '--version'];

  readonly capabilities: AgentCapability = {
    strengths: ['web-research', 'fast', 'creative', 'multimodal', 'free-tier-friendly'],
    weaknesses: ['weaker-coding', 'inconsistent-output', 'shorter-context'],
    supportedLanguages: ['python', 'javascript', 'typescript', 'go', 'java'],
    maxContextTokens: 1000000,
    tools: ['bash', 'read', 'write', 'edit', 'web-search', 'web-fetch', 'grep'],
  };

  constructor(config: AgentConfig = {}) {
    super(config);
    this.config = {
      timeoutMs: 90000,
    };
    if (config.timeoutMs !== undefined) this.config.timeoutMs = config.timeoutMs;
    if (config.workingDir !== undefined) this.config.workingDir = config.workingDir;
    if (config.env !== undefined) this.config.env = config.env;
    if (config.model !== undefined) this.config.model = config.model;
  }

  async checkInstalled(): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      const result = execSync('npx @google/gemini-cli --version 2>&1', { timeout: 30000, encoding: 'utf-8' });
      return { available: true, version: result.trim() };
    } catch (err) {
      return { available: false, error: (err as Error).message };
    }
  }

  async send(message: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const args = [
        '--prompt', message,
        '--output-format', 'json',
        '--yolo',
      ];

      let output = '';
      let stderr = '';

      const proc = crossSpawn(this.command, ['@google/gemini-cli', ...args], {
        cwd: this.config.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NO_COLOR: 'true',
          GOOGLE_API_KEY: this.config.env?.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || '',
        },
      });

      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Timeout after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        const duration = Date.now() - startTime;

        if (code === 0 && output.trim()) {
          const parsed = this.parseResponse(output.trim(), id);
          resolve(this.createMessage(id, parsed.response, output, parsed.tools, { duration, stats: parsed.stats, files: parsed.files, exitCode: code }));
        } else if (stderr) {
          try {
            const parsed = JSON.parse(stderr.trim());
            resolve(this.createMessage(id, parsed.response || stderr, stderr, parsed.tools || [], { duration, stats: parsed.stats, exitCode: code }));
          } catch {
            resolve(this.createMessage(id, stderr.trim(), stderr, [], { exitCode: code, duration, error: stderr.slice(0, 500) }));
          }
        } else {
          resolve(this.createMessage(id, output.trim() || 'No output', output, [], { exitCode: code, duration }));
        }
      });
    });
  }

  async sendWithInput(prompt: string, inputContent: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const args = [
        '--output-format', 'json',
        '--yolo',
        '--prompt', prompt,
      ];

      let output = '';

      const proc = crossSpawn(this.command, ['@google/gemini-cli', ...args], {
        cwd: this.config.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NO_COLOR: 'true',
          GOOGLE_API_KEY: this.config.env?.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || '',
        },
      });

      proc.stdin?.write(inputContent);
      proc.stdin?.end();

      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Timeout after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        const duration = Date.now() - startTime;

        try {
          const parsed = JSON.parse(output.trim());
          resolve(this.createMessage(id, parsed.response || output, output, [], { duration, stats: parsed.stats, exitCode: code }));
        } catch {
          resolve(this.createMessage(id, output.trim(), output, [], { exitCode: code, duration }));
        }
      });
    });
  }

  private parseResponse(raw: string, _id: string): GeminiResult {
    const result: GeminiResult = {
      response: '',
      stats: { tools: { totalCalls: 0, totalSuccess: 0, totalFail: 0, totalDurationMs: 0 } },
      tools: [],
      files: [],
    };

    try {
      const parsed = JSON.parse(raw);

      if (parsed.response) {
        result.response = parsed.response;
      } else if (parsed.text) {
        result.response = parsed.text;
      } else if (parsed.message) {
        result.response = parsed.message;
      } else if (parsed.content) {
        result.response = parsed.content;
      } else {
        result.response = JSON.stringify(parsed, null, 2);
      }

      if (parsed.stats) {
        result.stats = parsed.stats;
      }

      if (parsed.stats?.tools?.byName) {
        for (const [toolName, toolStats] of Object.entries(parsed.stats.tools.byName)) {
          result.tools.push({
            name: toolName,
            args: {},
            result: JSON.stringify(toolStats),
            success: (toolStats as Record<string, number>).totalSuccess > 0,
          });
        }
      }

      if (parsed.stats?.files) {
        const filePattern = /[`"]([^`"]+\.(ts|js|py|go|rs|java|cpp|c))[`"]/g;
        const matches = result.response.matchAll(filePattern);
        for (const m of matches) {
          result.files.push({ path: m[1], action: 'created' });
        }
      }
    } catch {
      result.response = raw;
    }

    return result;
  }

  async analyzeCodebase(path: string): Promise<TerminalMessage> {
    const prompt = `Analyze the codebase at "${path}". Return a structured analysis including:
1. Main technologies and frameworks
2. Project structure
3. Key files and their purposes
4. Any obvious issues or areas needing improvement
Format as clean JSON.`;

    return this.send(prompt);
  }

  async research(query: string): Promise<TerminalMessage> {
    const prompt = `Research and provide information about: ${query}. Be concise and accurate.`;
    return this.send(prompt);
  }

  handleStdout(_data: string): void {}
  handleStderr(_data: string): void {}
}
