import { execSync, ChildProcess } from 'child_process';
import { BaseAgent, crossSpawn, AgentCapability, AgentConfig, TerminalMessage, ToolCall } from './BaseAgent.js';
import { getProviderManager } from '../../core/provider-manager.js';


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
    if (GeminiCliAgent.installChecked) {
      return { available: GeminiCliAgent.isInstalled, version: GeminiCliAgent.isInstalled ? 'CLI' : undefined };
    }
    GeminiCliAgent.installChecked = true;
    try {
      execSync('npx --no-install @google/gemini-cli --version 2>&1', { timeout: 2000, stdio: 'pipe' });
      GeminiCliAgent.isInstalled = true;
      return { available: true, version: 'CLI' };
    } catch {
      GeminiCliAgent.isInstalled = false;
      return { available: false, version: undefined, error: '@google/gemini-cli not installed. Run: npm install -g @google/gemini-cli' };
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

  async send(message: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();
    return await this.sendOneShot(message, id, startTime);
  }

  async sendWithInput(prompt: string, inputContent: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();
    return await this.sendOneShot(`${prompt}\n\n${inputContent}`, id, startTime);
  }

  private sendOneShot(prompt: string, id: string, startTime: number): Promise<TerminalMessage> {
    return new Promise((resolve) => {
      const args = ['run', prompt];

      let output = '';
      let stderr = '';
      let timedOut = false;

      const proc = crossSpawn(this.command, ['--yes', '@google/gemini-cli', ...args], {
        cwd: this.config.workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: 'true', ...this.config.env },
      });

      proc.on('error', async () => {
        if (!timedOut) { clearTimeout(timeout); resolve(this.createMessage(id, '@google/gemini-cli: spawn failed', '', [], { duration: Date.now() - startTime })); }
      });

      proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

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
          resolve(this.createMessage(id, parsed.response || output.trim(), output, parsed.tools, { exitCode: code, duration, files: parsed.files }));
        } else {
          const errMsg = stderr.trim() || `@google/gemini-cli exited with code ${code}`;
          resolve(this.createMessage(id, `@google/gemini-cli failed: ${errMsg}`, output || errMsg, [], { duration, exitCode: code }));
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
      return this.createMessage(id, parsed.response || res.content, res.content, parsed.tools, { duration, files: parsed.files });
    } catch {
      return this.createMessage(id, 'EamilOS: no AI provider available. Configure a provider or install opencode-ai.', '', [], { duration, files: [] });
    }
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
