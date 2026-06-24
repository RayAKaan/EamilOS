import { execSync } from 'child_process';
import { BaseAgent, AgentCapability, AgentConfig, TerminalMessage } from './BaseAgent.js';

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
    try {
      const result = execSync(
        'npx --no-install @google/gemini-cli --version 2>&1',
        { timeout: 15000, encoding: 'utf-8' }
      );
      const version = this.extractVersion(result);
      return { available: true, version };
    } catch {
      try {
        const npmCheck = execSync(
          'npm list @google/gemini-cli --depth=0 2>&1',
          { timeout: 10000, encoding: 'utf-8' }
        );
        if (npmCheck.toString().includes('@google/gemini-cli')) {
          return { available: true, version: 'installed via npm' };
        }
      } catch {}
      return {
        available: false,
        error: 'Gemini CLI not found. Run: npm install -g @google/gemini-cli',
      };
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
    return this.kernelFallback(message, id, startTime);
  }

  async sendWithInput(prompt: string, inputContent: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();
    return this.kernelFallback(prompt + '\n\n---\n\n' + inputContent, id, startTime);
  }

  private async kernelFallback(message: string, id: string, startTime: number): Promise<TerminalMessage> {
    try {
      const { getProviderManager } = await import('../../core/provider-manager.js');
      const pm = getProviderManager();
      const result = await pm.chat([
        {
          role: 'system',
          content: 'You are Gemini CLI, an elite research and analysis agent inside the EamilOS unified swarm. Focus on analysis, planning, and review. Be concise and provide structured output.',
        },
        { role: 'user', content: message },
      ]);
      const content = result.content || '(empty response from kernel)';
      this.emit('chunk', 'gemini', content);
      return this.createMessage(id, content, content, [], { duration: Date.now() - startTime, kernelFallback: true });
    } catch (err) {
      return this.createErrorMessage(id, `Kernel fallback failed: ${(err as Error).message}`, startTime, {});
    }
  }

  private createErrorMessage(id: string, content: string, startTime: number, extra: Record<string, unknown> = {}): TerminalMessage {
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
