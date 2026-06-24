import { execSync } from 'child_process';
import { BaseAgent, AgentCapability, AgentConfig, TerminalMessage } from './BaseAgent.js';

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
    try {
      const result = execSync('npx --no-install opencode-ai --version 2>&1', { timeout: 15000, encoding: 'utf-8' });
      const version = this.extractVersion(result);
      return { available: true, version };
    } catch {
      try {
        const result = execSync('npx --no-install opencode --version 2>&1', { timeout: 15000, encoding: 'utf-8' });
        const version = this.extractVersion(result);
        return { available: true, version };
      } catch {
        try {
          const npmList = execSync('npm list -g opencode-ai opencode 2>&1', { timeout: 10000, encoding: 'utf-8' });
          if (npmList.toString().includes('opencode')) {
            return { available: true, version: 'installed (version check unavailable)' };
          }
        } catch {}

        return {
          available: false,
          error: 'OpenCode not found. Run: npm install -g opencode-ai',
        };
      }
    }
  }

  private extractVersion(output: string): string {
    const lines = output.split('\n');
    for (const line of lines) {
      const match = line.match(/(\d+\.\d+\.\d+)/);
      if (match) return match[1];
      const scopeMatch = line.match(/@[\w-]+\/[\w-]+@(\d+\.\d+\.\d+)/);
      if (scopeMatch) return scopeMatch[1];
    }
    return output.trim().split('\n').filter(l => l.includes('.')).find(l => l) || 'unknown';
  }

  async send(message: string): Promise<TerminalMessage> {
    const id = this.generateId();
    const startTime = Date.now();
    return this.kernelFallback(message, id, startTime);
  }

  private async kernelFallback(message: string, id: string, startTime: number): Promise<TerminalMessage> {
    try {
      const { getProviderManager } = await import('../../core/provider-manager.js');
      const pm = getProviderManager();
      const result = await pm.chat([
        {
          role: 'system',
          content: 'You are OpenCode, an elite code-generation agent inside the EamilOS unified swarm. Output working production-ready code files as JSON: {"files": [{"path": "...", "content": "..."}]}. Never output descriptions or placeholders.',
        },
        { role: 'user', content: message },
      ]);
      const content = result.content || '(empty response from kernel)';
      this.emitChunk('opencode', content);
      return this.createMessage(id, content, content, [], { duration: Date.now() - startTime, kernelFallback: true });
    } catch (err) {
      return this.createErrorMessage(id, `Kernel fallback failed: ${(err as Error).message}`, startTime);
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

  async terminate(): Promise<void> {
  }

  handleStdout(_data: string): void {}
  handleStderr(_data: string): void {}
}
