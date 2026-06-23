import { execSync, ChildProcess } from 'child_process';
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
    strengths: ['web-research', 'fast', 'creative', 'multimodal', 'free-tier-friendly', 'long-context'],
    weaknesses: ['weaker-coding', 'inconsistent-output', 'shorter-native-context'],
    supportedLanguages: ['python', 'javascript', 'typescript', 'go', 'java', 'rust', 'cpp'],
    maxContextTokens: 1000000,
    tools: ['bash', 'read', 'write', 'edit', 'web-search', 'web-fetch', 'grep', 'git'],
  };

  private static installChecked = false;
  private static isInstalled = false;
  private static cachedVersion: string | null = null;

  constructor(config: AgentConfig = {}) {
    super(config);
    this.config = {
      timeoutMs: 120000,
      ...config,
    };
    if (config.timeoutMs !== undefined) this.config.timeoutMs = config.timeoutMs;
    if (config.workingDir !== undefined) this.config.workingDir = config.workingDir;
    if (config.env !== undefined) this.config.env = config.env;
    if (config.model !== undefined) this.config.model = config.model;
  }

  async checkInstalled(): Promise<{ available: boolean; version?: string; error?: string }> {
    if (GeminiCliAgent.installChecked && GeminiCliAgent.cachedVersion !== null) {
      return {
        available: GeminiCliAgent.isInstalled,
        version: GeminiCliAgent.cachedVersion || undefined,
        error: GeminiCliAgent.isInstalled ? undefined : 'Package not found',
      };
    }

    try {
      const result = execSync(
        `npx @google/gemini-cli --version 2>&1`,
        { timeout: 30000, encoding: 'utf-8' }
      );

      const version = this.extractVersion(result);
      GeminiCliAgent.installChecked = true;
      GeminiCliAgent.isInstalled = true;
      GeminiCliAgent.cachedVersion = version;

      return { available: true, version };
    } catch (err) {
      const errorMsg = (err as Error).message;

      if (this.isCommandNotFoundError(errorMsg)) {
        try {
          const npmCheck = execSync(
            'npm list @google/gemini-cli --depth=0 2>&1',
            { timeout: 10000, encoding: 'utf-8' }
          );

          if (npmCheck.toString().includes('@google/gemini-cli')) {
            GeminiCliAgent.installChecked = true;
            GeminiCliAgent.isInstalled = true;
            GeminiCliAgent.cachedVersion = 'installed via npm';
            return { available: true, version: 'installed via npm' };
          }
        } catch {}

        GeminiCliAgent.installChecked = true;
        GeminiCliAgent.isInstalled = false;
        GeminiCliAgent.cachedVersion = null;

        return {
          available: false,
          error: 'Gemini CLI not found. Run: npm install -g @google/gemini-cli',
        };
      }

      try {
        execSync('npx --version 2>&1', { timeout: 5000, encoding: 'utf-8' });
        GeminiCliAgent.installChecked = true;
        GeminiCliAgent.isInstalled = false;
        GeminiCliAgent.cachedVersion = null;
        return {
          available: false,
          error: `Package check failed: ${errorMsg.slice(0, 200)}`,
        };
      } catch {
        return {
          available: false,
          error: 'npx not available — Node.js may not be properly installed',
        };
      }
    }
  }

  private extractVersion(output: string): string {
    const lines = output.split('\n');
    for (const line of lines) {
      const match = line.match(/(\d+\.\d+\.\d+)/);
      if (match) return match[1];
    }
    return output.trim().split('\n')[0] || 'unknown';
  }

  private isCommandNotFoundError(msg: string): boolean {
    const patterns = [
      'command not found',
      'enoent',
      'spawn',
      'ENOENT',
      'not found',
      'npm ERR',
    ];
    return patterns.some(p => msg.toLowerCase().includes(p.toLowerCase()));
  }

  async send(message: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();

    const health = await this.checkInstalled();
    if (!health.available) {
      return this.createErrorMessage(
        id,
        `Gemini CLI not available: ${health.error}`,
        startTime,
        { errorType: 'not-installed' }
      );
    }

    return new Promise((resolve) => {
      const args = [
        '--prompt', message,
        '--output-format', 'json',
        '--yolo',
      ];

      let output = '';
      let stderr = '';
      let timedOut = false;

      const proc = crossSpawn(this.command, ['@google/gemini-cli', ...args], {
        cwd: this.config.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NO_COLOR: 'true',
          GOOGLE_API_KEY: this.config.env?.GOOGLE_API_KEY
            || process.env.GOOGLE_API_KEY
            || '',
        },
      });

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        this.emit('chunk', 'gemini', chunk);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        this.emit('chunk', 'gemini', chunk);
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        try { proc.kill(); } catch {}
        resolve(this.createErrorMessage(
          id,
          `Timeout after ${this.config.timeoutMs}ms`,
          startTime,
          { errorType: 'timeout' }
        ));
      }, this.config.timeoutMs);

      proc.on('close', (code) => {
        if (timedOut) return;
        clearTimeout(timeout);
        const duration = Date.now() - startTime;

        if (code === 0 && output.trim()) {
          const parsed = this.parseResponse(output.trim(), id);
          resolve(this.createMessage(
            id,
            parsed.response,
            output,
            parsed.tools,
            { duration, stats: parsed.stats, files: parsed.files, exitCode: code }
          ));
        } else if (stderr.trim()) {
          try {
            const parsed = JSON.parse(stderr.trim());
            resolve(this.createMessage(
              id,
              parsed.response || parsed.text || stderr,
              stderr,
              parsed.tools || [],
              { duration, stats: parsed.stats, exitCode: code }
            ));
          } catch {
            if (this.isAuthError(stderr)) {
              resolve(this.createErrorMessage(
                id,
                `Authentication failed: ${stderr.slice(0, 300)}`,
                startTime,
                { errorType: 'auth', stderr: stderr.slice(0, 500) }
              ));
            } else {
              resolve(this.createMessage(
                id,
                stderr.trim(),
                stderr,
                [],
                { exitCode: code, duration, error: stderr.slice(0, 500) }
              ));
            }
          }
        } else {
          resolve(this.createMessage(
            id,
            output.trim() || 'No output from Gemini CLI',
            output,
            [],
            { exitCode: code, duration }
          ));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve(this.createErrorMessage(
          id,
          `Process error: ${err.message}`,
          startTime,
          { errorType: 'process-error' }
        ));
      });
    });
  }

  async sendWithInput(prompt: string, inputContent: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();

    const health = await this.checkInstalled();
    if (!health.available) {
      return this.createErrorMessage(
        id,
        `Gemini CLI not available: ${health.error}`,
        startTime,
        { errorType: 'not-installed' }
      );
    }

    return new Promise((resolve) => {
      const args = [
        '--output-format', 'json',
        '--yolo',
        '--prompt', prompt,
      ];

      let output = '';
      let timedOut = false;

      const proc = crossSpawn(this.command, ['@google/gemini-cli', ...args], {
        cwd: this.config.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NO_COLOR: 'true',
          GOOGLE_API_KEY: this.config.env?.GOOGLE_API_KEY
            || process.env.GOOGLE_API_KEY
            || '',
        },
      });

      proc.stdin?.write(inputContent);
      proc.stdin?.end();

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        this.emit('chunk', 'gemini', chunk);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        this.emit('chunk', 'gemini', `[stderr] ${chunk}`);
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        try { proc.kill(); } catch {}
        resolve(this.createErrorMessage(id, `Timeout after ${this.config.timeoutMs}ms`, startTime, { errorType: 'timeout' }));
      }, this.config.timeoutMs);

      proc.on('close', (code) => {
        if (timedOut) return;
        clearTimeout(timeout);
        const duration = Date.now() - startTime;

        try {
          const parsed = JSON.parse(output.trim());
          resolve(this.createMessage(
            id,
            parsed.response || output,
            output,
            [],
            { duration, stats: parsed.stats, exitCode: code }
          ));
        } catch {
          resolve(this.createMessage(
            id,
            output.trim(),
            output,
            [],
            { exitCode: code, duration }
          ));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve(this.createErrorMessage(id, `Process error: ${err.message}`, startTime, { errorType: 'process-error' }));
      });
    });
  }

  private parseResponse(raw: string, _id: string): GeminiResult {
    const result: GeminiResult = {
      response: '',
      stats: {
        tools: {
          totalCalls: 0,
          totalSuccess: 0,
          totalFail: 0,
          totalDurationMs: 0
        }
      },
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
      } else if (parsed.result) {
        result.response = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
      } else if (parsed.output) {
        result.response = typeof parsed.output === 'string' ? parsed.output : JSON.stringify(parsed.output);
      } else {
        result.response = JSON.stringify(parsed, null, 2).slice(0, 5000);
      }

      if (parsed.stats) {
        result.stats = parsed.stats;
      }

      if (parsed.stats?.tools?.byName) {
        for (const [toolName, toolStats] of Object.entries(parsed.stats.tools.byName as Record<string, unknown>)) {
          result.tools.push({
            name: toolName,
            args: {},
            result: JSON.stringify(toolStats),
            success: (toolStats as Record<string, number>).totalSuccess > 0,
          });
        }
      }

      if (parsed.stats?.files || result.response) {
        const filePattern = /[`"']?([^\s`"'\n]+\.(ts|js|tsx|jsx|py|go|rs|java|cpp|c|h))[`"']?/g;
        const matches = result.response.matchAll(filePattern);
        for (const m of matches) {
          const path = m[1];
          if (!result.files.find(f => f.path === path)) {
            result.files.push({ path, action: 'created' });
          }
        }
      }

    } catch {
      result.response = raw;
    }

    return result;
  }

  private isAuthError(stderr: string): boolean {
    const authPatterns = [
      'authentication',
      'auth method',
      'api.key',
      'not configured',
      'credential',
      'invalid api key',
      'unauthorized',
      'google_auth',
      'GOOGLE_API_KEY',
      'oauth',
      'login required',
      'permission denied',
    ];

    const lower = stderr.toLowerCase();
    return authPatterns.some(pattern => lower.includes(pattern.toLowerCase()));
  }

  private createErrorMessage(id: string, content: string, startTime: number, extra: Record<string, unknown>): TerminalMessage {
    return {
      id,
      timestamp: Date.now(),
      content,
      metadata: {
        duration: Date.now() - startTime,
        error: true,
        ...extra,
      },
    };
  }

  async analyzeCodebase(path: string): Promise<TerminalMessage> {
    const prompt = `Analyze the codebase at "${path}". Return a structured analysis in JSON format:
{
  "technologies": ["list of main technologies"],
  "structure": "brief description of project structure",
  "keyFiles": [{"path": "file.ts", "purpose": "what it does"}],
  "issues": ["any obvious issues or improvements needed"],
  "recommendations": ["suggested next steps"]
}`;

    return this.send(prompt);
  }

  async research(query: string): Promise<TerminalMessage> {
    const prompt = `Research and provide information about: ${query}. Be concise, accurate, and structure your response clearly.`;
    return this.send(prompt);
  }

  handleStdout(_data: string): void {}
  handleStderr(_data: string): void {}
}
