import { EamilOSAgent, AgentRequest, AgentResponse, AgentKind, AgentCapabilities, RegisteredAgent } from './EamilOSAgent.js';
import { AgentRegistry } from './AgentRegistry.js';
import { OpenCodeAgent } from '../../multi-agent/agents/OpenCodeAgent.js';
import { ClaudeCodeAgent } from '../../multi-agent/agents/ClaudeCodeAgent.js';
import { GeminiCliAgent } from '../../multi-agent/agents/GeminiCliAgent.js';
import { AiderAgent } from '../../multi-agent/agents/AiderAgent.js';
import { GooseAgent } from '../../multi-agent/agents/GooseAgent.js';

const BASE_CAPABILITIES: Record<string, AgentCapabilities> = {
  opencode: { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: true, longContext: true, local: true, cloud: true, multimodal: false },
  'claude-code': { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: true, longContext: true, local: false, cloud: true, multimodal: false },
  'gemini-cli': { codeGeneration: false, fileEditing: false, commandExecution: true, webResearch: true, longContext: true, local: false, cloud: true, multimodal: true },
  aider: { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: false, longContext: false, local: true, cloud: false, multimodal: false },
  goose: { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: false, longContext: false, local: true, cloud: false, multimodal: false },
};

const AGENT_KINDS: Record<string, AgentKind> = {
  opencode: 'cli',
  'claude-code': 'cli',
  'gemini-cli': 'cli',
  aider: 'cli',
  goose: 'cli',
};

export class AgentFactory {
  static createAdapter(agentId: string, config?: { workingDir?: string; timeoutMs?: number }): EamilOSAgent | null {
    switch (agentId) {
      case 'opencode':
        return new OpenCodeAgentAdapter(config);
      case 'claude-code':
        return new ClaudeCodeAgentAdapter(config);
      case 'gemini-cli':
        return new GeminiCliAgentAdapter(config);
      case 'aider':
        return new AiderAgentAdapter(config);
      case 'goose':
        return new GooseAgentAdapter(config);
      default:
        return null;
    }
  }

  static async createBestAdapter(registry: AgentRegistry, mode?: 'communication' | 'execution', preferId?: string): Promise<EamilOSAgent | null> {
    const agent = registry.getBestAgent(mode, preferId);
    if (!agent) return null;
    return AgentFactory.createAdapter(agent.id);
  }
}

class OpenCodeAgentAdapter implements EamilOSAgent {
  id = 'opencode';
  name = 'OpenCode AI';
  kind: AgentKind = 'cli';
  capabilities: AgentCapabilities = BASE_CAPABILITIES.opencode;
  private inner: OpenCodeAgent;

  constructor(config?: { workingDir?: string; timeoutMs?: number }) {
    this.inner = new OpenCodeAgent({
      workingDir: config?.workingDir,
      timeoutMs: config?.timeoutMs ?? 180000,
    });
  }

  async checkStatus(): Promise<RegisteredAgent> {
    const result = await this.inner.checkInstalled();
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      provider: 'opencode',
      status: result.available ? 'available' : 'not_installed',
      version: result.version,
      capabilities: this.capabilities,
      supportedModes: ['execution'],
      priority: 1,
      error: result.error,
    };
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const start = Date.now();
    try {
      const msg = await this.inner.send(request.prompt);
      return {
        agentId: this.id,
        success: true,
        content: msg.content,
        fileChanges: [],
        rawOutput: msg.raw,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        agentId: this.id,
        success: false,
        content: '',
        fileChanges: [],
        error: err instanceof Error ? err.message : String(err),
        errorType: 'unknown',
        durationMs: Date.now() - start,
      };
    }
  }

  async stop(): Promise<void> {
    await this.inner.terminate();
  }
}

class ClaudeCodeAgentAdapter implements EamilOSAgent {
  id = 'claude-code';
  name = 'Claude Code';
  kind: AgentKind = 'cli';
  capabilities: AgentCapabilities = BASE_CAPABILITIES['claude-code'];
  private inner: ClaudeCodeAgent;

  constructor(config?: { workingDir?: string; timeoutMs?: number }) {
    this.inner = new ClaudeCodeAgent({
      workingDir: config?.workingDir,
      timeoutMs: config?.timeoutMs ?? 180000,
    });
  }

  async checkStatus(): Promise<RegisteredAgent> {
    const result = await this.inner.checkInstalled();
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      provider: 'anthropic',
      status: result.available ? 'available' : 'not_installed',
      version: result.version,
      capabilities: this.capabilities,
      supportedModes: ['execution'],
      priority: 2,
      error: result.error,
    };
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const start = Date.now();
    try {
      const msg = await this.inner.send(request.prompt);
      return {
        agentId: this.id,
        success: true,
        content: msg.content,
        fileChanges: [],
        rawOutput: msg.raw,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        agentId: this.id,
        success: false,
        content: '',
        fileChanges: [],
        error: err instanceof Error ? err.message : String(err),
        errorType: 'unknown',
        durationMs: Date.now() - start,
      };
    }
  }

  async stop(): Promise<void> {
    await this.inner.terminate();
  }
}

class GeminiCliAgentAdapter implements EamilOSAgent {
  id = 'gemini-cli';
  name = 'Gemini CLI';
  kind: AgentKind = 'cli';
  capabilities: AgentCapabilities = BASE_CAPABILITIES['gemini-cli'];
  private inner: GeminiCliAgent;

  constructor(config?: { workingDir?: string; timeoutMs?: number }) {
    this.inner = new GeminiCliAgent({
      workingDir: config?.workingDir,
      timeoutMs: config?.timeoutMs ?? 120000,
    });
  }

  async checkStatus(): Promise<RegisteredAgent> {
    const result = await this.inner.checkInstalled();
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      provider: 'google',
      status: result.available ? 'available' : 'not_installed',
      version: result.version,
      capabilities: this.capabilities,
      supportedModes: ['communication', 'execution'],
      priority: 3,
      error: result.error,
    };
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const start = Date.now();
    try {
      const msg = await this.inner.send(request.prompt);
      return {
        agentId: this.id,
        success: true,
        content: msg.content,
        fileChanges: [],
        rawOutput: msg.raw,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        agentId: this.id,
        success: false,
        content: '',
        fileChanges: [],
        error: err instanceof Error ? err.message : String(err),
        errorType: 'unknown',
        durationMs: Date.now() - start,
      };
    }
  }

  async stop(): Promise<void> {
    await this.inner.terminate();
  }
}

class AiderAgentAdapter implements EamilOSAgent {
  id = 'aider';
  name = 'Aider';
  kind: AgentKind = 'cli';
  capabilities: AgentCapabilities = BASE_CAPABILITIES.aider;
  private inner: AiderAgent;

  constructor(config?: { workingDir?: string; timeoutMs?: number }) {
    this.inner = new AiderAgent({
      workingDir: config?.workingDir,
      timeoutMs: config?.timeoutMs ?? 180000,
    });
  }

  async checkStatus(): Promise<RegisteredAgent> {
    const result = await this.inner.checkInstalled();
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      provider: 'aider',
      status: result.available ? 'available' : 'not_installed',
      version: result.version,
      capabilities: this.capabilities,
      supportedModes: ['execution'],
      priority: 4,
      error: result.error,
    };
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const start = Date.now();
    try {
      const msg = await this.inner.send(request.prompt);
      return {
        agentId: this.id,
        success: true,
        content: msg.content,
        fileChanges: [],
        rawOutput: msg.raw,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        agentId: this.id,
        success: false,
        content: '',
        fileChanges: [],
        error: err instanceof Error ? err.message : String(err),
        errorType: 'unknown',
        durationMs: Date.now() - start,
      };
    }
  }

  async stop(): Promise<void> {
    await this.inner.terminate();
  }
}

class GooseAgentAdapter implements EamilOSAgent {
  id = 'goose';
  name = 'Goose';
  kind: AgentKind = 'cli';
  capabilities: AgentCapabilities = BASE_CAPABILITIES.goose;
  private inner: GooseAgent;

  constructor(config?: { workingDir?: string; timeoutMs?: number }) {
    this.inner = new GooseAgent({
      workingDir: config?.workingDir,
      timeoutMs: config?.timeoutMs ?? 120000,
    });
  }

  async checkStatus(): Promise<RegisteredAgent> {
    const result = await this.inner.checkInstalled();
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      provider: 'block',
      status: result.available ? 'available' : 'not_installed',
      version: result.version,
      capabilities: this.capabilities,
      supportedModes: ['execution'],
      priority: 5,
      error: result.error,
    };
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const start = Date.now();
    try {
      const msg = await this.inner.send(request.prompt);
      return {
        agentId: this.id,
        success: true,
        content: msg.content,
        fileChanges: [],
        rawOutput: msg.raw,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        agentId: this.id,
        success: false,
        content: '',
        fileChanges: [],
        error: err instanceof Error ? err.message : String(err),
        errorType: 'unknown',
        durationMs: Date.now() - start,
      };
    }
  }

  async stop(): Promise<void> {
    await this.inner.terminate();
  }
}
