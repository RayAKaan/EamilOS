import { EventEmitter } from 'events';
import { AgentRegistry } from '../../core/agents/AgentRegistry.js';
import { AgentFactory } from '../../core/agents/AgentFactory.js';
import { classifyAgentError, isFallbackTrigger } from '../../core/agents/AgentErrorClassifier.js';
import { TaskPlanner } from './TaskPlanner.js';
import type { EamilOSAgent } from '../../core/agents/EamilOSAgent.js';
import type { AgentMode, AgentErrorType } from '../../core/agents/types.js';

export interface SwarmCoordinatorConfig {
  goal: string;
  projectId: string;
  strategy: 'single' | 'single-fallback' | 'fallback' | 'swarm' | 'manual';
  mode: AgentMode;
  workingDir: string;
  maxRetries?: number;
  timeoutMs?: number;
  preferredAgent?: string;
  preferredProvider?: string;
  preferredModel?: string;
}

export interface SwarmResult {
  success: boolean;
  goal: string;
  strategy: string;
  mode: AgentMode;
  agentUsed?: string;
  primaryResult?: string;
  fileChanges: any[];
  errors: string[];
  duration: number;
}

export class SwarmCoordinator extends EventEmitter {
  private config: SwarmCoordinatorConfig;
  private planner: TaskPlanner;
  private agents: Map<string, EamilOSAgent> = new Map();

  constructor(config: SwarmCoordinatorConfig) {
    super();
    this.config = {
      maxRetries: 3,
      timeoutMs: 240000,
      ...config,
    };
    this.planner = new TaskPlanner();
  }

  async orchestrate(): Promise<SwarmResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    this.emit('session.started', {
      goal: this.config.goal,
      strategy: this.config.strategy,
      mode: this.config.mode,
    });

    try {
      let result: SwarmResult;

      switch (this.config.strategy) {
        case 'single':
          result = await this.executeSingle();
          break;
        case 'fallback':
          result = await this.executeFallback();
          break;
        case 'swarm':
          result = await this.executeSwarm();
          break;
        default:
          result = await this.executeFallback();
      }

      result.duration = Date.now() - startTime;
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
        fileChanges: [],
        errors,
        duration: Date.now() - startTime,
      };
    }
  }

  private async executeSingle(): Promise<SwarmResult> {
    const agent = await this.selectPreferredAgent();
    if (!agent) {
      return this.noAgentResult('No available agent found');
    }

    this.agents.set(agent.id, agent);
    return this.runAgent(agent, this.config.goal);
  }

  private async executeFallback(): Promise<SwarmResult> {
    const primary = await this.selectPreferredAgent();
    if (!primary) {
      return this.noAgentResult('No available agent found');
    }

    this.agents.set(primary.id, primary);
    const firstResult = await this.runAgentSafely(primary, this.config.goal);

    if (firstResult.success) {
      return {
        success: true,
        goal: this.config.goal,
        strategy: 'fallback',
        mode: this.config.mode,
        agentUsed: primary.id,
        primaryResult: firstResult.content,
        fileChanges: firstResult.fileChanges,
        errors: [],
        duration: 0,
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
        fileChanges: firstResult.fileChanges,
        errors: [firstResult.error || 'Primary agent failed, not fallback-eligible'],
        duration: 0,
      };
    }

    const fallbackAgent = await this.findFallback(primary.id);
    if (!fallbackAgent) {
      return {
        success: false,
        goal: this.config.goal,
        strategy: 'fallback',
        mode: this.config.mode,
        agentUsed: primary.id,
        primaryResult: firstResult.content,
        fileChanges: firstResult.fileChanges,
        errors: [firstResult.error || 'Primary agent failed, no fallback available'],
        duration: 0,
      };
    }

    this.emit('agent.fallback', { from: primary.id, to: fallbackAgent.id, reason: firstResult.error || 'primary failed' });
    this.agents.set(fallbackAgent.id, fallbackAgent);
    return this.runAgent(fallbackAgent, this.config.goal);
  }

  private async executeSwarm(): Promise<SwarmResult> {
    const available = await this.getAvailableAgents();
    if (available.length === 0) {
      return this.noAgentResult('No available agents for swarm');
    }

    const topAgents = available.slice(0, 3);
    const promises = topAgents.map(async (agent) => {
      this.agents.set(agent.id, agent);
      return this.runAgentSafely(agent, this.config.goal);
    });

    const results = await Promise.allSettled(promises);
    const successes = results
      .filter((r): r is PromiseFulfilledResult<{ success: boolean; content: string; fileChanges: any[]; agentId: string; error?: string }> =>
        r.status === 'fulfilled' && r.value !== null && r.value.success
      )
      .map(r => r.value);

    if (successes.length === 0) {
      return {
        success: false,
        goal: this.config.goal,
        strategy: 'swarm',
        mode: this.config.mode,
        fileChanges: [],
        errors: ['All swarm agents failed'],
        duration: 0,
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
      fileChanges: best.fileChanges,
      errors: [],
      duration: 0,
    };
  }

  private async selectPreferredAgent(): Promise<EamilOSAgent | null> {
    const registry = AgentRegistry.create();
    await registry.detect();

    if (this.config.preferredAgent) {
      const agent = AgentFactory.createAdapter(this.config.preferredAgent, {
        workingDir: this.config.workingDir,
        timeoutMs: this.config.timeoutMs,
      });
      if (agent) return agent;
    }

    if (this.config.preferredProvider) {
      const agent = AgentFactory.createBestAdapter(registry, this.config.mode, undefined);
      if (agent) return agent;
    }

    return AgentFactory.createBestAdapter(registry, this.config.mode, this.config.preferredAgent);
  }

  private async findFallback(currentId: string): Promise<EamilOSAgent | null> {
    const registry = AgentRegistry.create();
    await registry.detect();

    const available = registry.getAvailableAgents(this.config.mode);
    const fallbackId = available
      .filter(a => a.id !== currentId)
      .sort((a, b) => a.priority - b.priority)[0]?.id;

    if (!fallbackId) return null;

    return AgentFactory.createAdapter(fallbackId, {
      workingDir: this.config.workingDir,
      timeoutMs: this.config.timeoutMs,
    });
  }

  private async getAvailableAgents(): Promise<EamilOSAgent[]> {
    const registry = AgentRegistry.create();
    await registry.detect();

    const available = registry.getAvailableAgents(this.config.mode);
    return available.map(a =>
      AgentFactory.createAdapter(a.id, {
        workingDir: this.config.workingDir,
        timeoutMs: this.config.timeoutMs,
      })
    ).filter(Boolean) as EamilOSAgent[];
  }

  private async runAgent(agent: EamilOSAgent, prompt: string): Promise<SwarmResult> {
    this.emit('agent.started', { agentId: agent.id });
    this.emit('agent.output', { agentId: agent.id, content: `Starting ${agent.id}...` });

    try {
      const response = await agent.run({
        id: `req_${Date.now()}`,
        sessionId: `session_${Date.now()}`,
        prompt,
        systemPrompt: '[EamilOS] Generate verified production-ready code.',
        mode: this.config.mode,
        workingDir: this.config.workingDir,
        timeoutMs: this.config.timeoutMs ?? 240000,
      });

      this.emit('agent.completed', { agentId: agent.id, result: response });

      return {
        success: response.success,
        goal: this.config.goal,
        strategy: this.config.strategy,
        mode: this.config.mode,
        agentUsed: agent.id,
        primaryResult: response.content,
        fileChanges: response.fileChanges,
        errors: response.error ? [response.error] : [],
        duration: 0,
      };
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
        errors: [msg],
        duration: 0,
      };
    }
  }

  private async runAgentSafely(agent: EamilOSAgent, prompt: string): Promise<{ success: boolean; content: string; fileChanges: any[]; agentId: string; error?: string }> {
    this.emit('agent.started', { agentId: agent.id });

    try {
      const response = await agent.run({
        id: `req_${Date.now()}`,
        sessionId: `session_${Date.now()}`,
        prompt,
        systemPrompt: '[EamilOS] Generate verified production-ready code.',
        mode: this.config.mode,
        workingDir: this.config.workingDir,
        timeoutMs: this.config.timeoutMs ?? 240000,
      });

      return {
        success: response.success,
        content: response.content,
        fileChanges: response.fileChanges,
        agentId: agent.id,
        error: response.error,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        content: '',
        fileChanges: [],
        agentId: agent.id,
        error: msg,
      };
    }
  }

  private noAgentResult(error: string): SwarmResult {
    return {
      success: false,
      goal: this.config.goal,
      strategy: this.config.strategy,
      mode: this.config.mode,
      fileChanges: [],
      errors: [error],
      duration: 0,
    };
  }
}
