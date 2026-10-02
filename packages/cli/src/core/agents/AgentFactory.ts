import { getUniversalAgentPlatform } from './universal/UniversalAgentPlatform.js';
import { EamilOSAgent, AgentRequest, AgentResponse, AgentKind, AgentCapabilities, RegisteredAgent } from './EamilOSAgent.js';
import { AgentRegistry } from './AgentRegistry.js';
import { OpenCodeAgent } from '../../multi-agent/agents/OpenCodeAgent.js';
import { ClaudeCodeAgent } from '../../multi-agent/agents/ClaudeCodeAgent.js';
import { GeminiCliAgent } from '../../multi-agent/agents/GeminiCliAgent.js';
import { AiderAgent } from '../../multi-agent/agents/AiderAgent.js';
import { GooseAgent } from '../../multi-agent/agents/GooseAgent.js';
import { CodexCliAgent } from '../../multi-agent/agents/CodexCliAgent.js';
import { DeepSeekHarnessAgent } from '../../multi-agent/agents/DeepSeekHarnessAgent.js';
import { extractFileChanges } from '../parsers/ResponseParser.js';
import { OpenAIAgentAdapter } from './adapters/OpenAIAgentAdapter.js';
import { AnthropicAgentAdapter } from './adapters/AnthropicAgentAdapter.js';
import { OllamaAgentAdapter } from './adapters/OllamaAgentAdapter.js';
import { GoogleAgentAdapter } from './adapters/GoogleAgentAdapter.js';
import type { TerminalMessage } from '../../multi-agent/agents/BaseAgent.js';
import { classifyAgentError } from './AgentErrorClassifier.js';
import type { AgentErrorType } from './types.js';

const FAILURE_PATTERNS = [
  /Claude Code failed:/i,
  /opencode-ai failed:/i,
  /@google\/gemini-cli failed:/i,
  /Aider failed:/i,
  /Goose failed:/i,
  /codex-cli: timed out/i,
  /codex-cli: spawn failed/i,
  /codex-cli: exit code/i,
  /Agent timed out after \d+s/i,
  /EamilOS: no AI provider available/i,
  /exited with code \d+/i,
];

export function terminalMessageToAgentResponse(
  agentId: string,
  message: TerminalMessage,
  start: number,
  fileChanges: AgentResponse['fileChanges']
): AgentResponse {
  const exitCode = message.metadata?.exitCode as number | undefined;
  const content = message.content ?? '';
  const rawOutput = message.raw;

  let failureReason: string | undefined;
  let errorType: AgentErrorType | undefined;

  if (exitCode !== undefined && exitCode !== 0) {
    failureReason = content || `${agentId} exited with code ${exitCode}`;
    errorType = classifyAgentError(failureReason, rawOutput ?? '');
  } else if (content) {
    for (const pattern of FAILURE_PATTERNS) {
      if (pattern.test(content)) {
        failureReason = content;
        errorType = classifyAgentError(failureReason, rawOutput ?? '');
        break;
      }
    }
  }

  if (failureReason) {
    return {
      agentId,
      success: false,
      content: '',
      fileChanges: [],
      rawOutput,
      error: failureReason,
      errorType: errorType ?? 'unknown',
      durationMs: Date.now() - start,
    };
  }

  return {
    agentId,
    success: true,
    content,
    fileChanges,
    rawOutput,
    durationMs: Date.now() - start,
  };
}

export function errorToAgentResponse(
  agentId: string,
  err: unknown,
  start: number,
): AgentResponse {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    agentId,
    success: false,
    content: '',
    fileChanges: [],
    error: msg,
    errorType: classifyAgentError(msg, ''),
    durationMs: Date.now() - start,
  };
}

const BASE_CAPABILITIES: Record<string, AgentCapabilities> = {
  opencode: { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: true, longContext: true, local: true, cloud: true, multimodal: false },
  'claude-code': { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: true, longContext: true, local: false, cloud: true, multimodal: false },
  'gemini-cli': { codeGeneration: false, fileEditing: false, commandExecution: true, webResearch: true, longContext: true, local: false, cloud: true, multimodal: true },
  aider: { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: false, longContext: false, local: true, cloud: false, multimodal: false },
  goose: { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: false, longContext: false, local: true, cloud: false, multimodal: false },
  'codex-cli': { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: false, longContext: true, local: true, cloud: false, multimodal: false },
  'deepseek-harness': { codeGeneration: true, fileEditing: true, commandExecution: true, webResearch: true, longContext: true, local: true, cloud: true, multimodal: false },
};

async function runCancellable(
  inner: { send(prompt: string): Promise<TerminalMessage>; terminate(): Promise<void>; on: Function; off: Function },
  request: AgentRequest,
): Promise<TerminalMessage> {
  if (request.signal?.aborted) {
    throw new Error('Mission cancelled');
  }
  const onChunk = request.onOutput ? (_name: string, chunk: string) => request.onOutput!(chunk) : undefined;
  if (onChunk) inner.on('chunk', onChunk);
  let removeAbort: (() => void) | undefined;
  try {
    const sendPromise = inner.send(request.prompt);
    if (!request.signal) return await sendPromise;
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => {
        void inner.terminate().catch(() => undefined);
        reject(new Error('Mission cancelled'));
      };
      request.signal!.addEventListener('abort', onAbort, { once: true });
      removeAbort = () => request.signal?.removeEventListener('abort', onAbort);
    });
    return await Promise.race([sendPromise, abortPromise]);
  } finally {
    removeAbort?.();
    if (onChunk) inner.off('chunk', onChunk);
  }
}

const AGENT_KINDS: Record<string, AgentKind> = {
  opencode: 'cli',
  'claude-code': 'cli',
  'gemini-cli': 'cli',
  aider: 'cli',
  goose: 'cli',
  'codex-cli': 'cli',
  'deepseek-harness': 'harness',
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
      case 'codex-cli':
        return new CodexCliAgentAdapter(config);
      case 'deepseek-harness':
        return new DeepSeekHarnessAgentAdapter(config);
      case 'openai-api':
        return new OpenAIAgentAdapter();
      case 'anthropic-api':
        return new AnthropicAgentAdapter();
      case 'ollama':
        return new OllamaAgentAdapter();
      case 'google-api':
        return new GoogleAgentAdapter();
      default:
        return new UniversalAgentAdapter(agentId, config);
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
      supportedModes: ['communication', 'execution'],
      priority: 1,
      error: result.error,
    };
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const start = Date.now();
    try {
      const msg = await runCancellable(this.inner, request);
      const fileChanges = extractFileChanges(msg.content, this.id);
      return terminalMessageToAgentResponse(this.id, msg, start, fileChanges);
    } catch (err) {
      return errorToAgentResponse(this.id, err, start);
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
      supportedModes: ['communication', 'execution'],
      priority: 2,
      error: result.error,
    };
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const start = Date.now();
    try {
      const msg = await runCancellable(this.inner, request);
      const fileChanges = extractFileChanges(msg.content, this.id);
      return terminalMessageToAgentResponse(this.id, msg, start, fileChanges);
    } catch (err) {
      return errorToAgentResponse(this.id, err, start);
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
      const msg = await runCancellable(this.inner, request);
      const fileChanges = extractFileChanges(msg.content, this.id);
      return terminalMessageToAgentResponse(this.id, msg, start, fileChanges);
    } catch (err) {
      return errorToAgentResponse(this.id, err, start);
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
      supportedModes: ['communication', 'execution'],
      priority: 4,
      error: result.error,
    };
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const start = Date.now();
    try {
      const msg = await runCancellable(this.inner, request);
      const fileChanges = extractFileChanges(msg.content, this.id);
      return terminalMessageToAgentResponse(this.id, msg, start, fileChanges);
    } catch (err) {
      return errorToAgentResponse(this.id, err, start);
    }
  }

  async stop(): Promise<void> {
    await this.inner.terminate();
  }
}

class CodexCliAgentAdapter implements EamilOSAgent {
  id = 'codex-cli';
  name = 'Codex CLI';
  kind: AgentKind = 'cli';
  capabilities: AgentCapabilities = BASE_CAPABILITIES['codex-cli'];
  private inner: CodexCliAgent;

  constructor(config?: { workingDir?: string; timeoutMs?: number }) {
    this.inner = new CodexCliAgent({
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
      provider: 'openai',
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
      const msg = await runCancellable(this.inner, request);
      const fileChanges = extractFileChanges(msg.content, this.id);
      return terminalMessageToAgentResponse(this.id, msg, start, fileChanges);
    } catch (err) {
      return errorToAgentResponse(this.id, err, start);
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
      supportedModes: ['communication', 'execution'],
      priority: 5,
      error: result.error,
    };
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const start = Date.now();
    try {
      const msg = await runCancellable(this.inner, request);
      const fileChanges = extractFileChanges(msg.content, this.id);
      return terminalMessageToAgentResponse(this.id, msg, start, fileChanges);
    } catch (err) {
      return errorToAgentResponse(this.id, err, start);
    }
  }

  async stop(): Promise<void> {
    await this.inner.terminate();
  }
}

class DeepSeekHarnessAgentAdapter implements EamilOSAgent {
  id = 'deepseek-harness';
  name = 'DeepSeek Harness';
  kind: AgentKind = 'harness';
  capabilities: AgentCapabilities = BASE_CAPABILITIES['deepseek-harness'];
  private inner: DeepSeekHarnessAgent;

  constructor(config?: { workingDir?: string; timeoutMs?: number }) {
    this.inner = new DeepSeekHarnessAgent({
      workingDir: config?.workingDir,
      timeoutMs: config?.timeoutMs ?? 240000,
    });
  }

  async checkStatus(): Promise<RegisteredAgent> {
    const result = await this.inner.checkInstalled();
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      provider: 'deepseek',
      status: result.available ? 'available' : 'not_installed',
      version: result.version,
      capabilities: this.capabilities,
      supportedModes: ['communication', 'execution'],
      priority: 5,
      error: result.error,
    };
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const start = Date.now();
    try {
      const msg = await runCancellable(this.inner, request);
      return terminalMessageToAgentResponse(this.id, msg, start, extractFileChanges(msg.content, this.id));
    } catch (err) {
      return errorToAgentResponse(this.id, err, start);
    }
  }

  async stop(): Promise<void> {
    await this.inner.terminate();
  }
}


class UniversalAgentAdapter implements EamilOSAgent {
  readonly kind: AgentKind;
  readonly capabilities: AgentCapabilities;
  private readonly agentId: string;
  readonly name: string;

  constructor(agentId: string, private readonly config?: { workingDir?: string; timeoutMs?: number }) {
    const definition = getUniversalAgentPlatform().registry.get(agentId);
    if (!definition) throw new Error('Unknown universal agent: ' + agentId);
    this.agentId = agentId;
    this.kind = definition.kind === 'harness' ? 'harness' : definition.kind === 'api' ? 'api' : 'cli';
    this.name = definition.name;
    this.capabilities = {
      codeGeneration: definition.capabilities.codeGeneration,
      fileEditing: definition.capabilities.fileEditing,
      commandExecution: definition.capabilities.commandExecution,
      webResearch: definition.capabilities.webResearch,
      longContext: definition.capabilities.longContext,
      local: definition.capabilities.local,
      cloud: definition.capabilities.cloud,
      multimodal: definition.capabilities.multimodal,
    };
  }

  get id(): string { return this.agentId; }

  async checkStatus(): Promise<RegisteredAgent> {
    const platform = getUniversalAgentPlatform();
    const health = await platform.registry.health(this.agentId);
    const definition = platform.registry.get(this.agentId)!;
    return {
      id: this.agentId, name: this.name, kind: this.kind, provider: definition.provider,
      status: !health.installed ? 'not_installed' : health.authenticated === false ? 'auth_missing' : health.ready ? 'available' : 'unavailable',
      version: health.version, capabilities: this.capabilities, supportedModes: ['communication', 'execution'],
      priority: 10, error: health.checks.find((check) => !check.ok)?.detail,
    };
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const platform = getUniversalAgentPlatform();
    const result = await platform.scheduler.execute({
      request: { ...request, workingDir: request.workingDir || this.config?.workingDir || process.cwd(), timeoutMs: request.timeoutMs || this.config?.timeoutMs || 180000 },
      preferredAgentId: this.agentId, strictAgentId: true,
    });
    return result.response;
  }

  async stop(): Promise<void> {
    // Universal sessions are owned by the terminal manager/runtime; lifecycle shutdown is handled by the runtime.
  }
}
