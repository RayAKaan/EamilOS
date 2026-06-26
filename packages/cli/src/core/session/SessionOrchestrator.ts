import { EventEmitter } from 'events';
import { AgentRegistry } from '../agents/AgentRegistry.js';
import { AgentFactory } from '../agents/AgentFactory.js';
import { ConstraintEnforcer, getConstraintEnforcer } from '../../terminal/ConstraintEnforcer.js';
import { AdaptiveMultiplexer, getAdaptiveMultiplexer } from '../../terminal/AdaptiveMultiplexer.js';
import { StagingWorkspace, getStagingWorkspace } from '../workspace/StagingWorkspace.js';
import { takeWorkspaceSnapshot, diffWorkspace } from '../changes/ChangeCollector.js';
import { validateChanges } from '../validation/ChangeValidationPipeline.js';
import { applyChanges } from '../changes/DiffApplier.js';
import { parsePolicy } from '../policy/ExecutionPolicy.js';
import type { EamilOSAgent } from '../agents/EamilOSAgent.js';
import type { AgentRequest, AgentResponse, ProposedFileChange } from '../agents/types.js';
import type { ExecutionStrategy, AgentMode, SessionConfig } from '../agents/types.js';
import type { ExecutionPolicy } from '../policy/ExecutionPolicy.js';
import type { FileChange } from '../changes/ChangeCollector.js';

export interface SessionEventMap {
  'session.started': { goal: string; strategy: ExecutionStrategy; mode: AgentMode };
  'agent.started': { agentId: string };
  'agent.output': { agentId: string; content: string };
  'agent.fallback': { from: string; to: string; reason: string };
  'agent.completed': { agentId: string; result: AgentResponse };
  'agent.error': { agentId: string; error: string; errorType?: string };
  'file.proposed': { file: ProposedFileChange };
  'validation.started': {};
  'validation.passed': {};
  'validation.failed': { errors: string[] };
  'changes.collected': { changes: FileChange[] };
  'changes.applied': { applied: string[]; failed: { path: string; error: string }[] };
  'staging.cleaned': { sessionId: string };
  'session.completed': { success: boolean; duration: number };
  'session.error': { error: string };
}

export interface SessionResult {
  success: boolean;
  goal: string;
  strategy: ExecutionStrategy;
  mode: AgentMode;
  agentUsed?: string;
  primaryResult?: string;
  fileChanges: ProposedFileChange[];
  appliedChanges: string[];
  errors: string[];
  duration: number;
}

const SYSTEM_PROMPT = `
[EamilOS 1.6.0 — Unified Autonomous Multi-Agent Kernel]
You are operating as a specialized intelligence node within EamilOS.
Generate verified, validated, production-ready working code.
NO PLACEHOLDERS, NO TODOS, NO DESCRIPTIONS.
Respond with valid JSON:
{
  "summary": "Architectural overview",
  "files": [{"path": "relative/path.ext", "content": "..."}]
}
`.trim();

export class SessionOrchestrator extends EventEmitter {
  private registry: AgentRegistry;
  private config: SessionConfig;
  private constraintEnforcer: ConstraintEnforcer;
  private stagingWorkspace: StagingWorkspace;
  private agents: Map<string, EamilOSAgent> = new Map();
  private startTime = 0;
  private fileChanges: ProposedFileChange[] = [];
  private policy: ExecutionPolicy;

  constructor(config: SessionConfig) {
    super();
    this.config = {
      maxRetries: 3,
      timeoutMs: 240000,
      ...config,
    };
    this.registry = AgentRegistry.create();
    this.constraintEnforcer = getConstraintEnforcer();
    this.stagingWorkspace = getStagingWorkspace();
    this.policy = parsePolicy(config.policy);
  }

  on<K extends keyof SessionEventMap>(event: K, listener: (data: SessionEventMap[K]) => void): this {
    return super.on(event, listener);
  }

  emit<K extends keyof SessionEventMap>(event: K, data: SessionEventMap[K]): boolean {
    return super.emit(event, data);
  }

  async run(): Promise<SessionResult> {
    this.startTime = Date.now();
    const errors: string[] = [];

    this.emit('session.started', {
      goal: this.config.goal,
      strategy: this.config.strategy,
      mode: this.config.mode,
    });

    const terminalEnv = AdaptiveMultiplexer.detectEnvironment();
    const canMultiplex = AdaptiveMultiplexer.isMultiplexingSupported();

    try {
      await this.registry.detect();

      const strategy = this.config.strategy;
      let result: SessionResult;

      switch (strategy) {
        case 'single':
          result = await this.executeSingle();
          break;
        case 'fallback':
          result = await this.executeFallback();
          break;
        case 'swarm':
          result = await this.executeSwarm();
          break;
        case 'manual':
          result = await this.executeSingle();
          break;
        default:
          result = await this.executeFallback();
      }

      result.duration = Date.now() - this.startTime;
      this.emit('session.completed', { success: result.success, duration: result.duration });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      this.emit('session.error', { error: msg });
      return {
        success: false,
        goal: this.config.goal,
        strategy: this.config.strategy,
        mode: this.config.mode,
        fileChanges: this.fileChanges,
        appliedChanges: [],
        errors,
        duration: Date.now() - this.startTime,
      };
    } finally {
      this.stagingWorkspace.cleanupAll();
    }
  }

  private async executeSingle(): Promise<SessionResult> {
    const agent = await AgentFactory.createBestAdapter(this.registry, this.config.mode, this.config.preferredAgent);
    if (!agent) {
      return this.noAgentResult('No available agent found');
    }

    this.agents.set(agent.id, agent);

    if (this.config.mode === 'communication') {
      return this.executeInCommunicationMode(agent);
    }

    return this.executeAgentWithChanges(agent, this.config.goal);
  }

  private async executeFallback(): Promise<SessionResult> {
    const primary = await AgentFactory.createBestAdapter(this.registry, this.config.mode, this.config.preferredAgent);
    if (!primary) {
      return this.noAgentResult('No available agent found');
    }

    this.agents.set(primary.id, primary);

    const firstResult = await this.executeAgentSafely(primary, this.config.goal);
    if (firstResult.success) {
      return {
        success: true,
        goal: this.config.goal,
        strategy: 'fallback',
        mode: this.config.mode,
        agentUsed: primary.id,
        primaryResult: firstResult.content,
        fileChanges: this.fileChanges,
        appliedChanges: [],
        errors: [],
        duration: Date.now() - this.startTime,
      };
    }

    const fallbackId = this.findFallbackAgent(primary.id);
    if (!fallbackId) {
      return {
        success: false,
        goal: this.config.goal,
        strategy: 'fallback',
        mode: this.config.mode,
        agentUsed: primary.id,
        primaryResult: firstResult.content,
        fileChanges: this.fileChanges,
        appliedChanges: [],
        errors: [firstResult.error || 'Primary agent failed, no fallback available'],
        duration: Date.now() - this.startTime,
      };
    }

    this.emit('agent.fallback', { from: primary.id, to: fallbackId, reason: firstResult.error || 'primary failed' });

    const fallback = AgentFactory.createAdapter(fallbackId, {
      workingDir: this.config.workingDir,
      timeoutMs: this.config.timeoutMs,
    });
    if (!fallback) {
      return this.noAgentResult('Fallback agent could not be created');
    }

    this.agents.set(fallback.id, fallback);
    return this.executeAgentWithChanges(fallback, this.config.goal);
  }

  private async executeSwarm(): Promise<SessionResult> {
    const available = this.registry.getAvailableAgents(this.config.mode);
    if (available.length === 0) {
      return this.noAgentResult('No available agents for swarm');
    }

    const topAgents = available.slice(0, 3);
    const promises = topAgents.map(async (a) => {
      const adapter = AgentFactory.createAdapter(a.id, {
        workingDir: this.config.workingDir,
        timeoutMs: this.config.timeoutMs,
      });
      if (!adapter) return null;

      this.agents.set(adapter.id, adapter);
      return this.executeAgentSafely(adapter, this.config.goal);
    });

    const results = await Promise.allSettled(promises);
    const successes = results.filter(
      (r): r is PromiseFulfilledResult<AgentResponse> => r.status === 'fulfilled' && r.value !== null && r.value.success
    ).map(r => r.value);

    if (successes.length === 0) {
      return {
        success: false,
        goal: this.config.goal,
        strategy: 'swarm',
        mode: this.config.mode,
        fileChanges: this.fileChanges,
        appliedChanges: [],
        errors: ['All swarm agents failed'],
        duration: Date.now() - this.startTime,
      };
    }

    const best = successes.reduce((a, b) => (a.content.length > b.content.length ? a : b));
    return {
      success: true,
      goal: this.config.goal,
      strategy: 'swarm',
      mode: this.config.mode,
      agentUsed: best.agentId,
      primaryResult: best.content,
      fileChanges: this.fileChanges,
      appliedChanges: [],
      errors: [],
      duration: Date.now() - this.startTime,
    };
  }

  private async executeInCommunicationMode(agent: EamilOSAgent): Promise<SessionResult> {
    const workingDir = this.constraintEnforcer.createIsolatedContext(agent.id, this.config.workingDir);

    const request: AgentRequest = {
      id: `req_${Date.now()}`,
      sessionId: `session_${Date.now()}`,
      prompt: `[READ-ONLY MODE] Analyze and provide recommendations only. Do not modify any files.\n\nTask: ${this.config.goal}`,
      systemPrompt: `${SYSTEM_PROMPT}\n\nIMPORTANT: You are in READ-ONLY mode. Do not write, edit, or modify any files. Only analyze and propose changes.`,
      mode: 'communication',
      workingDir,
      timeoutMs: this.config.timeoutMs ?? 240000,
    };

    try {
      const response = await agent.run(request);
      this.emit('agent.completed', { agentId: agent.id, result: response });

      if (response.fileChanges.length > 0) {
        this.emit('validation.failed', { errors: ['File changes blocked in communication mode'] });
      }

      return {
        success: true,
        goal: this.config.goal,
        strategy: this.config.strategy,
        mode: 'communication',
        agentUsed: agent.id,
        primaryResult: response.content,
        fileChanges: [],
        appliedChanges: [],
        errors: [],
        duration: Date.now() - this.startTime,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('agent.error', { agentId: agent.id, error: msg });
      return {
        success: false,
        goal: this.config.goal,
        strategy: this.config.strategy,
        mode: 'communication',
        agentUsed: agent.id,
        fileChanges: [],
        appliedChanges: [],
        errors: [msg],
        duration: Date.now() - this.startTime,
      };
    }
  }

  private async executeAgentSafely(agent: EamilOSAgent, prompt: string): Promise<AgentResponse> {
    this.emit('agent.started', { agentId: agent.id });
    this.emit('agent.output', { agentId: agent.id, content: `Starting ${agent.id}...` });

    const request: AgentRequest = {
      id: `req_${Date.now()}`,
      sessionId: `session_${Date.now()}`,
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      mode: this.config.mode,
      workingDir: this.config.workingDir,
      timeoutMs: this.config.timeoutMs ?? 240000,
    };

    try {
      const response = await agent.run(request);
      this.emit('agent.completed', { agentId: agent.id, result: response });
      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('agent.error', { agentId: agent.id, error: msg });
      return {
        agentId: agent.id,
        success: false,
        content: '',
        fileChanges: [],
        error: msg,
        errorType: 'unknown',
        durationMs: 0,
      };
    }
  }

  private async executeAgentWithChanges(agent: EamilOSAgent, prompt: string): Promise<SessionResult> {
    const session = this.stagingWorkspace.createSession(agent.id, this.config.workingDir);
    const stagingDir = session.workspaceDir;

    const beforeSnapshot = takeWorkspaceSnapshot(stagingDir);

    const request: AgentRequest = {
      id: `req_${Date.now()}`,
      sessionId: `session_${Date.now()}`,
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      mode: 'execution',
      workingDir: stagingDir,
      timeoutMs: this.config.timeoutMs ?? 240000,
    };

    let response: AgentResponse;
    try {
      this.emit('agent.output', { agentId: agent.id, content: `Starting ${agent.id} in staging workspace...` });
      response = await agent.run(request);
      this.emit('agent.completed', { agentId: agent.id, result: response });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('agent.error', { agentId: agent.id, error: msg });
      return {
        success: false,
        goal: this.config.goal,
        strategy: this.config.strategy,
        mode: this.config.mode,
        agentUsed: agent.id,
        fileChanges: [],
        appliedChanges: [],
        errors: [msg],
        duration: Date.now() - this.startTime,
      };
    }

    const afterSnapshot = takeWorkspaceSnapshot(stagingDir);
    const detectedChanges = diffWorkspace(beforeSnapshot, afterSnapshot, stagingDir, agent.id);

    this.emit('changes.collected', { changes: detectedChanges });

    if (detectedChanges.length === 0) {
      return {
        success: response.success,
        goal: this.config.goal,
        strategy: this.config.strategy,
        mode: this.config.mode,
        agentUsed: agent.id,
        primaryResult: response.content,
        fileChanges: response.fileChanges,
        appliedChanges: [],
        errors: response.error ? [response.error] : [],
        duration: Date.now() - this.startTime,
      };
    }

    const validationResult = validateChanges(detectedChanges, this.policy);
    this.emit('validation.started', {});

    if (!validationResult.valid) {
      this.emit('validation.failed', { errors: validationResult.issues.filter(i => i.severity === 'error').map(i => i.message) });
      return {
        success: false,
        goal: this.config.goal,
        strategy: this.config.strategy,
        mode: this.config.mode,
        agentUsed: agent.id,
        primaryResult: response.content,
        fileChanges: response.fileChanges,
        appliedChanges: [],
        errors: validationResult.issues.filter(i => i.severity === 'error').map(i => `[${i.path}] ${i.message}`),
        duration: Date.now() - this.startTime,
      };
    }

    this.emit('validation.passed', {});

    const applyResult = applyChanges(detectedChanges, this.config.workingDir);
    this.emit('changes.applied', { applied: applyResult.applied, failed: applyResult.failed });

    this.emit('staging.cleaned', { sessionId: session.id });

    return {
      success: applyResult.success,
      goal: this.config.goal,
      strategy: this.config.strategy,
      mode: this.config.mode,
      agentUsed: agent.id,
      primaryResult: response.content,
      fileChanges: response.fileChanges,
      appliedChanges: applyResult.applied,
      errors: applyResult.failed.map(f => `Failed to apply ${f.path}: ${f.error}`),
      duration: Date.now() - this.startTime,
    };
  }

  private findFallbackAgent(currentId: string): string | null {
    const available = this.registry.getAvailableAgents(this.config.mode);
    const fallbacks = available.filter(a => a.id !== currentId).sort((a, b) => a.priority - b.priority);
    return fallbacks[0]?.id ?? null;
  }

  private noAgentResult(error: string): SessionResult {
    return {
      success: false,
      goal: this.config.goal,
      strategy: this.config.strategy,
      mode: this.config.mode,
      fileChanges: [],
      appliedChanges: [],
      errors: [error],
      duration: Date.now() - this.startTime,
    };
  }

  async stop(): Promise<void> {
    for (const [, agent] of this.agents) {
      try {
        await agent.stop?.();
      } catch { }
    }
  }
}

export function createSessionOrchestrator(config: SessionConfig): SessionOrchestrator {
  return new SessionOrchestrator(config);
}
