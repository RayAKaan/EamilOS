import { EventEmitter } from 'events';
import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { resolve } from 'path';
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
  private sessionId = '';
  private fileChanges: ProposedFileChange[] = [];
  private policy: ExecutionPolicy;
  private permissionService: ReturnType<typeof getPermissionService>;
  private agentLogFiles: Map<string, string> = new Map();

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
    this.sessionId = `session_${this.startTime}`;
    const errors: string[] = [];

    this.emit('session.started', {
      goal: this.config.goal,
      strategy: this.config.strategy,
      mode: this.config.mode,
    });

    this.sessionStore.createSession(this.config.goal, this.config.mode, this.config.strategy, this.sessionId);

    let finalResult: SessionResult | null = null;

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

      finalResult = result;
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
        finalResult?.success ?? (!errors.length),
        finalResult?.agentUsed,
        finalResult?.duration ?? (Date.now() - this.startTime),
        finalResult?.errors ?? errors
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

  private async executeAgentForMode(agent: EamilOSAgent, prompt: string): Promise<SessionResult> {
    if (this.config.mode === 'communication') {
      return this.executeInCommunicationMode(agent);
    }
    return this.executeAgentWithChanges(agent, prompt);
  }

  private async executeFallback(routing: import('../routing/AgentRouter.js').RoutingDecision): Promise<SessionResult> {
    const primaryId = routing.selectedAgents[0] || this.config.preferredAgent;
    const preferred = primaryId
      ? AgentFactory.createAdapter(primaryId, { workingDir: this.config.workingDir, timeoutMs: this.config.timeoutMs })
      : await AgentFactory.createBestAdapter(this.registry, this.config.mode);

    if (!preferred) {
      return this.noAgentResult('No available agent found');
    }

    const allAvailable = this.registry.getAvailableAgents(this.config.mode);
    const remainingAvailable = allAvailable
      .filter(a => a.id !== preferred.id && !routing.fallbackChain.includes(a.id))
      .sort((a, b) => a.priority - b.priority)
      .map(a => a.id);

    const candidateIds = [
      preferred.id,
      ...routing.fallbackChain,
      ...remainingAvailable,
    ];

    const allErrors: string[] = [];

    for (let i = 0; i < candidateIds.length; i++) {
      const agentId = candidateIds[i];
      const adapter = AgentFactory.createAdapter(agentId, {
        workingDir: this.config.workingDir,
        timeoutMs: this.config.timeoutMs,
      });
      if (!adapter) continue;

      this.agents.set(adapter.id, adapter);

      if (i > 0) {
        this.emit('agent.fallback', {
          from: candidateIds[i - 1],
          to: agentId,
          reason: allErrors[allErrors.length - 1] || `${candidateIds[i - 1]} failed`,
        });
        this.sessionStore.recordFallback(candidateIds[i - 1], agentId);
      }

      const result = await this.executeAgentForMode(adapter, this.config.goal);

      if (result.success && result.errors.length === 0) {
        return { ...result, strategy: this.config.strategy, agentUsed: agentId };
      }

      const err = result.errors[0] ?? `${agentId} failed`;
      allErrors.push(`${agentId}: ${err}`);

      if (i < candidateIds.length - 1) {
        const errorType = classifyAgentError(err, '');
        if (!isFallbackTrigger(errorType)) {
          break;
        }
      }
    }

    return {
      success: false,
      goal: this.config.goal,
      strategy: this.config.strategy,
      mode: this.config.mode,
      agentUsed: candidateIds[candidateIds.length - 1] ?? primaryId ?? preferred.id,
      fileChanges: [],
      appliedChanges: [],
      errors: allErrors,
      duration: Date.now() - this.startTime,
    };
  }

  private async executeSwarm(routing: import('../routing/AgentRouter.js').RoutingDecision): Promise<SessionResult> {
    const agentIds = routing.selectedAgents.length > 0
      ? routing.selectedAgents
      : this.registry.getAvailableAgents(this.config.mode).slice(0, 3).map(a => a.id);

    if (agentIds.length === 0) {
      return this.noAgentResult('No available agents for swarm');
    }

    for (let i = 0; i < agentIds.length; i++) {
      this.prepareAgentLogFile(agentIds[i], this.callsignForIndex(i));
    }

    await this.startSwarmTerminals(agentIds);

    const promises = agentIds.map(async (id) => {
      const session = this.stagingWorkspace.createSession(id, this.config.workingDir);
      const stagingDir = session.workspaceDir;
      const beforeSnapshot = takeWorkspaceSnapshot(stagingDir);

      const adapter = AgentFactory.createAdapter(id, {
        workingDir: stagingDir,
        timeoutMs: this.config.timeoutMs,
      });
      if (!adapter) return null;

      this.agents.set(adapter.id, adapter);
      const response = await this.executeAgentSafely(adapter, this.config.goal, stagingDir);

      const afterSnapshot = takeWorkspaceSnapshot(stagingDir);
      const detectedChanges = diffWorkspace(beforeSnapshot, afterSnapshot, stagingDir, id);
      const fileChanges: ProposedFileChange[] = detectedChanges.map(d => ({
        path: d.path,
        action: d.action === 'deleted' ? 'delete' as const : d.action === 'modified' ? 'modify' as const : 'create' as const,
        content: d.content,
        sourceAgentId: id,
      }));

      return { ...response, fileChanges: [...fileChanges, ...response.fileChanges] };
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

    const best = successes.reduce((a, b) =>
      this.scoreAgentResponse(a) >= this.scoreAgentResponse(b) ? a : b
    );
    const resolvedChanges = await this.resolveSwarmFileChanges(successes);
    this.fileChanges = resolvedChanges;

    const applyResult =
      this.config.mode === 'execution'
        ? await this.applyResolvedSwarmChanges(resolvedChanges)
        : { applied: [], errors: [] };

    return {
      success: applyResult.errors.length === 0,
      goal: this.config.goal,
      strategy: 'swarm',
      mode: this.config.mode,
      agentUsed: best.agentId,
      primaryResult: best.content,
      fileChanges: resolvedChanges,
      appliedChanges: applyResult.applied,
      errors: applyResult.errors,
      duration: Date.now() - this.startTime,
    };
  }

  private async startSwarmTerminals(agentIds: string[]): Promise<void> {
    const canMultiplex = AdaptiveMultiplexer.isMultiplexingSupported();

    if (!canMultiplex) {
      this.emitAgentOutput('eamilos', 'No multiplex-capable terminal detected. Streaming agent output inside EamilOS TUI.\n');
      return;
    }

    const multiplexer = getAdaptiveMultiplexer();

    const terminals = agentIds.map((agentId, index) => {
      const callsign = this.callsignForIndex(index);
      const isolatedDir = this.constraintEnforcer.createIsolatedContext(
        agentId,
        this.config.workingDir
      );
      const logPath = this.prepareAgentLogFile(agentId, callsign);

      return {
        id: agentId,
        callsign,
        command: 'tail',
        args: ['-f', logPath],
        cwd: isolatedDir,
        mode: this.config.mode,
      };
    });

    const spawned = await multiplexer.spawnAgentTerminals(terminals, this.config.workingDir);

    for (const term of spawned) {
      this.emitAgentOutput(term.agentId, `Terminal pane spawned for ${term.callsign} (${term.mode}).\n`);
    }
  }

  private prepareAgentLogFile(agentId: string, callsign: string): string {
    const logDir = resolve(
      this.config.workingDir,
      '.eamilos',
      'agent-logs',
      String(this.startTime || Date.now()),
      callsign
    );
    mkdirSync(logDir, { recursive: true });
    const logPath = resolve(logDir, 'output.log');
    writeFileSync(logPath, `[${new Date().toISOString()}] [${callsign}] ${agentId} ready\n`);
    this.agentLogFiles.set(agentId, logPath);
    return logPath;
  }

  private appendAgentLog(agentId: string, content: string): void {
    const logPath = this.agentLogFiles.get(agentId);
    if (!logPath) return;
    try {
      appendFileSync(logPath, content);
    } catch { /* ignore */ }
  }

  private emitAgentOutput(agentId: string, content: string): void {
    this.appendAgentLog(agentId, content.endsWith('\n') ? content : `${content}\n`);
    this.emit('agent.output', { agentId, content });
  }

  private callsignForIndex(index: number): string {
    const callsigns = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];
    return callsigns[index] ?? `Agent-${index + 1}`;
  }

  private scoreAgentResponse(response: AgentResponse): number {
    let score = 0;

    if (response.success) score += 100;
    if (!response.error) score += 50;
    if (response.fileChanges?.length) score += response.fileChanges.length * 20;

    try {
      const parsed = JSON.parse(response.content);
      if (parsed.summary) score += 10;
      if (Array.isArray(parsed.files)) score += 30;
    } catch {
      // not JSON
    }

    if (/TODO|FIXME|placeholder/i.test(response.content)) score -= 50;
    if (/error|exception|failed/i.test(response.content.slice(0, 500))) score -= 20;

    score += Math.min(response.content.length / 500, 20);

    return score;
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

      this.emitAgentOutput('arbiter', `Resolved conflict for ${path}: ${resolution.winner.callsign} (${resolution.method})\n`);
    }

    return resolved;
  }

  private async executeInCommunicationMode(agent: EamilOSAgent): Promise<SessionResult> {
    const workingDir = this.constraintEnforcer.createIsolatedContext(agent.id, this.config.workingDir);

    const request: AgentRequest = {
      id: `req_${Date.now()}`,
      sessionId: this.sessionId,
      prompt: `[READ-ONLY MODE] Analyze and provide recommendations only. Do not modify any files.\n\nTask: ${this.config.goal}`,
      systemPrompt: `${SYSTEM_PROMPT}\n\nIMPORTANT: You are in READ-ONLY mode. Do not write, edit, or modify any files. Only analyze and propose changes.`,
      mode: 'communication',
      workingDir,
      timeoutMs: this.config.timeoutMs ?? 240000,
    };

    try {
      const response = await agent.run(request);

      if (!response.success || response.error) {
        const error = response.error ?? response.content ?? `${agent.id} failed`;
        this.emit('agent.error', { agentId: agent.id, error });
        return {
          success: false,
          goal: this.config.goal,
          strategy: this.config.strategy,
          mode: 'communication',
          agentUsed: agent.id,
          primaryResult: undefined,
          fileChanges: [],
          appliedChanges: [],
          errors: [error],
          duration: Date.now() - this.startTime,
        };
      }

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

  private async executeAgentSafely(agent: EamilOSAgent, prompt: string, workingDir?: string): Promise<AgentResponse> {
    this.emit('agent.started', { agentId: agent.id });
    this.emitAgentOutput(agent.id, `Starting ${agent.id}...\n`);
    this.sessionStore.recordAgentSelected(agent.id);

    const request: AgentRequest = {
      id: `req_${Date.now()}`,
      sessionId: this.sessionId,
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      mode: this.config.mode,
      workingDir: workingDir ?? this.config.workingDir,
      timeoutMs: this.config.timeoutMs ?? 240000,
      onOutput: (chunk: string) => {
        this.emit('agent.output', { agentId: agent.id, content: chunk });
        this.appendAgentLog(agent.id, chunk);
      },
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
      sessionId: this.sessionId,
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      mode: 'execution',
      workingDir: stagingDir,
      timeoutMs: this.config.timeoutMs ?? 240000,
      onOutput: (chunk: string) => {
        this.emit('agent.output', { agentId: agent.id, content: chunk });
        this.appendAgentLog(agent.id, chunk);
      },
    };

    let response: AgentResponse;
    try {
      this.emitAgentOutput(agent.id, `Starting ${agent.id} in staging workspace...\n`);
      response = await agent.run(request);
      if (response.content) {
        this.appendAgentLog(agent.id, response.content.endsWith('\n') ? response.content : `${response.content}\n`);
      }
      if (!response.success || response.error) {
        const error = response.error ?? response.content ?? `${agent.id} failed`;
        this.emit('agent.error', { agentId: agent.id, error });
        return {
          success: false,
          goal: this.config.goal,
          strategy: this.config.strategy,
          mode: this.config.mode,
          agentUsed: agent.id,
          primaryResult: undefined,
          fileChanges: [],
          appliedChanges: [],
          errors: [error],
          duration: Date.now() - this.startTime,
        };
      }
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

        const decision = await this.permissionService.waitForDecision(request, {
          timeoutMs: 300000,
          defaultDecision: 'deny',
        });

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

  private async applyResolvedSwarmChanges(changes: ProposedFileChange[]): Promise<{ applied: string[]; errors: string[] }> {
    const fileChanges: FileChange[] = changes.map((change) => ({
      path: change.path,
      action: change.action === 'delete'
        ? 'deleted'
        : change.action === 'modify'
          ? 'modified'
          : 'created',
      content: change.content ?? '',
      agentId: change.sourceAgentId ?? 'swarm',
    }));

    const validationResult = validateChanges(fileChanges, this.policy);
    this.emit('validation.started', {});

    if (!validationResult.valid) {
      const errors = validationResult.issues
        .filter(i => i.severity === 'error')
        .map(i => `[${i.path}] ${i.message}`);

      this.emit('validation.failed', { errors });
      return { applied: [], errors };
    }

    this.emit('validation.passed', {});

    for (const change of fileChanges) {
      const permCheck = this.permissionService.checkFileWrite(
        this.sessionId,
        change.agentId,
        change.path,
        'file:write'
      );

      if (!permCheck.allowed && permCheck.requireApproval) {
        const request = permCheck.request;
        if (!request) {
          return { applied: [], errors: [`Permission denied: write to ${change.path}`] };
        }

        const decision = await this.permissionService.waitForDecision(request, {
          timeoutMs: 300000,
          defaultDecision: 'deny',
        });

        if (decision !== 'allow-once' && decision !== 'allow-session') {
          return { applied: [], errors: [`Permission denied: write to ${change.path}`] };
        }
      }
    }

    const result = applyChanges(fileChanges, this.config.workingDir);
    this.emit('changes.applied', { applied: result.applied, failed: result.failed });

    return {
      applied: result.applied,
      errors: result.failed.map(f => `Failed to apply ${f.path}: ${f.error}`),
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
    getAdaptiveMultiplexer().terminateAll();
  }
}

export function createSessionOrchestrator(config: SessionConfig): SessionOrchestrator {
  return new SessionOrchestrator(config);
}
