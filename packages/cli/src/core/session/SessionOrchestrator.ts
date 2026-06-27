import { EventEmitter } from 'events';
import { AgentRegistry } from '../agents/AgentRegistry.js';
import { AgentFactory } from '../agents/AgentFactory.js';
import { classifyAgentError, isFallbackTrigger } from '../agents/AgentErrorClassifier.js';
import { ConstraintEnforcer, getConstraintEnforcer } from '../../terminal/ConstraintEnforcer.js';
import { ConflictArbiter } from '../comms/ConflictArbiter.js';
import { AdaptiveMultiplexer, getAdaptiveMultiplexer } from '../../terminal/AdaptiveMultiplexer.js';
import { StagingWorkspace, getStagingWorkspace } from '../workspace/StagingWorkspace.js';
import { takeWorkspaceSnapshot, diffWorkspace } from '../changes/ChangeCollector.js';
import { validateChanges } from '../validation/ChangeValidationPipeline.js';
import { applyChanges } from '../changes/DiffApplier.js';
import { parsePolicy } from '../policy/ExecutionPolicy.js';
import { SessionStore, getSessionStore } from './SessionStore.js';
import { planTask, suggestExecutionStrategy } from '../planning/TaskPlanner.js';
import { routeTask } from '../routing/AgentRouter.js';
import { getPermissionService } from '../permissions.js';
import type { EamilOSAgent } from '../agents/EamilOSAgent.js';
import type { AgentRequest, AgentResponse, ProposedFileChange, ExecutionStrategy, AgentMode, SessionConfig } from '../agents/types.js';
import type { ExecutionPolicy } from '../policy/ExecutionPolicy.js';
import type { FileChange } from '../changes/ChangeCollector.js';
import type { SessionEventMap } from './events.js';

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
  private sessionStore: SessionStore;
  private agents: Map<string, EamilOSAgent> = new Map();
  private startTime = 0;
  private fileChanges: ProposedFileChange[] = [];
  private policy: ExecutionPolicy;
  private permissionService: ReturnType<typeof getPermissionService>;

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
    this.sessionStore = getSessionStore();
    this.policy = parsePolicy(config.policy);
    this.permissionService = getPermissionService();
    this.permissionService.on('permission:requested', (request) => {
      this.emit('permission.requested', {
        agentId: request.agentId,
        action: request.action,
        details: request.reason,
        requestId: request.id,
      });
    });
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

    this.sessionStore.createSession(this.config.goal, this.config.mode, this.config.strategy);

    const terminalEnv = AdaptiveMultiplexer.detectEnvironment();
    const canMultiplex = AdaptiveMultiplexer.isMultiplexingSupported();

    try {
      await this.registry.detect();

      // Plan: decompose goal into subtasks
      const available = this.registry.getAvailableAgents(this.config.mode);
      const plan = planTask(this.config.goal, available.length > 0 ? available : undefined);

       // Determine effective strategy
      const effectiveStrategy: ExecutionStrategy =
        this.config.strategy === 'swarm' ? 'swarm' :
        this.config.strategy === 'single-fallback' ? 'single-fallback' :
        suggestExecutionStrategy(plan, available.length);

      // Route: pick best agent and fallback chain
      const routing = routeTask({
        plan,
        availableAgents: available,
        mode: this.config.mode,
        strategy: effectiveStrategy,
        preferredAgent: this.config.preferredAgent,
      });

      let result: SessionResult;

      switch (effectiveStrategy) {
        case 'single':
          result = await this.executeSingle(routing);
          break;
        case 'single-fallback':
        case 'fallback':
          result = await this.executeFallback(routing);
          break;
        case 'swarm':
          result = await this.executeSwarm(routing);
          break;
        default:
          result = await this.executeSingle(routing);
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
      this.sessionStore.recordResult(
        !errors.length,
        undefined,
        Date.now() - this.startTime,
        errors
      );
      await this.sessionStore.save();
      this.stagingWorkspace.cleanupAll();
    }
  }

  private async executeSingle(routing: import('../routing/AgentRouter.js').RoutingDecision): Promise<SessionResult> {
    const agentId = routing.selectedAgents[0] || this.config.preferredAgent;
    const agent = agentId
      ? AgentFactory.createAdapter(agentId, { workingDir: this.config.workingDir, timeoutMs: this.config.timeoutMs })
      : await AgentFactory.createBestAdapter(this.registry, this.config.mode);

    if (!agent) {
      return this.noAgentResult('No available agent found');
    }

    this.agents.set(agent.id, agent);

    if (this.config.mode === 'communication') {
      return this.executeInCommunicationMode(agent);
    }

    return this.executeAgentWithChanges(agent, this.config.goal);
  }

  private async executeFallback(routing: import('../routing/AgentRouter.js').RoutingDecision): Promise<SessionResult> {
    const fallbackChain = routing.fallbackChain.length > 0 ? routing.fallbackChain : undefined;
    const primaryId = routing.selectedAgents[0] || this.config.preferredAgent;
    const primary = primaryId
      ? AgentFactory.createAdapter(primaryId, { workingDir: this.config.workingDir, timeoutMs: this.config.timeoutMs })
      : await AgentFactory.createBestAdapter(this.registry, this.config.mode);

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

    const errorType = classifyAgentError(firstResult.error || '', '');
    if (!isFallbackTrigger(errorType)) {
      return {
        success: false,
        goal: this.config.goal,
        strategy: 'fallback',
        mode: this.config.mode,
        agentUsed: primary.id,
        primaryResult: firstResult.content,
        fileChanges: this.fileChanges,
        appliedChanges: [],
        errors: [firstResult.error || 'Primary agent failed, not fallback-eligible'],
        duration: Date.now() - this.startTime,
      };
    }

    const fallbackId = (fallbackChain && fallbackChain.length > 0) ? fallbackChain[0] : this.findFallbackAgent(primary.id);
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
    this.sessionStore.recordFallback(primary.id, fallbackId);

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

  private async executeSwarm(routing: import('../routing/AgentRouter.js').RoutingDecision): Promise<SessionResult> {
    const agentIds = routing.selectedAgents.length > 0
      ? routing.selectedAgents
      : this.registry.getAvailableAgents(this.config.mode).slice(0, 3).map(a => a.id);

    if (agentIds.length === 0) {
      return this.noAgentResult('No available agents for swarm');
    }

    const promises = agentIds.map(async (id) => {
      const adapter = AgentFactory.createAdapter(id, {
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
    const resolvedChanges = await this.resolveSwarmFileChanges(successes);
    this.fileChanges = resolvedChanges;

    return {
      success: true,
      goal: this.config.goal,
      strategy: 'swarm',
      mode: this.config.mode,
      agentUsed: best.agentId,
      primaryResult: best.content,
      fileChanges: resolvedChanges,
      appliedChanges: [],
      errors: [],
      duration: Date.now() - this.startTime,
    };
  }

  private async resolveSwarmFileChanges(successes: AgentResponse[]): Promise<ProposedFileChange[]> {
    const byPath = new Map<string, ProposedFileChange[]>();

    for (const response of successes) {
      for (const change of response.fileChanges ?? []) {
        const existing = byPath.get(change.path) ?? [];
        existing.push(change);
        byPath.set(change.path, existing);
      }
    }

    const arbiter = new ConflictArbiter();
    const resolved: ProposedFileChange[] = [];

    for (const [path, changes] of byPath) {
      if (changes.length === 1) {
        resolved.push(changes[0]!);
        continue;
      }

      const contentCandidates = changes.filter((c) => c.content !== undefined);

      if (contentCandidates.length === 0) {
        resolved.push(changes[0]!);
        continue;
      }

      const candidates = contentCandidates.map((change) => ({
        callsign: change.sourceAgentId,
        path,
        content: change.content ?? '',
        hash: ConflictArbiter.computeHash(
          change.sourceAgentId,
          path,
          change.content ?? ''
        ),
      }));

      const resolution = await arbiter.arbitrate(candidates);
      const winner = contentCandidates.find(
        (change) =>
          change.sourceAgentId === resolution.winner.callsign &&
          change.path === resolution.winner.path &&
          (change.content ?? '') === resolution.winner.content
      );

      resolved.push(winner ?? contentCandidates[0]!);

      this.emit('agent.output', {
        agentId: 'arbiter',
        content: `Resolved conflict for ${path}: ${resolution.winner.callsign} (${resolution.method})`,
      });
    }

    return resolved;
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
      this.sessionStore.recordTerminalOutput(agent.id, response.content);

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
    this.sessionStore.recordAgentSelected(agent.id);

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

    for (const change of detectedChanges) {
      const permCheck = this.permissionService.checkFileWrite(
        this.config.projectId,
        agent.id,
        change.path,
        'file:write'
      );
      if (!permCheck.allowed && permCheck.requireApproval) {
        const request = permCheck.request;

        if (!request) {
          return {
            success: false,
            goal: this.config.goal,
            strategy: this.config.strategy,
            mode: this.config.mode,
            agentUsed: agent.id,
            primaryResult: response.content,
            fileChanges: response.fileChanges,
            appliedChanges: [],
            errors: [`Permission denied: write to ${change.path}`],
            duration: Date.now() - this.startTime,
          };
        }

        this.emit('permission.requested', {
          agentId: agent.id,
          action: 'write',
          details: `Write to ${change.path}`,
          requestId: request.id,
        });

        const decision = await this.permissionService.waitForDecision(request);

        if (decision !== 'allow-once' && decision !== 'allow-session') {
          return {
            success: false,
            goal: this.config.goal,
            strategy: this.config.strategy,
            mode: this.config.mode,
            agentUsed: agent.id,
            primaryResult: response.content,
            fileChanges: response.fileChanges,
            appliedChanges: [],
            errors: [`Permission denied: write to ${change.path}`],
            duration: Date.now() - this.startTime,
          };
        }
      }
    }

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
