import { randomUUID } from 'node:crypto';
import type { AgentRequest, AgentResponse } from '../types.js';
import { CapabilityMatcher, type AgentCapabilityRequirements, type AgentMatch } from './CapabilityMatcher.js';
import { UniversalAgentRegistry } from './UniversalAgentRegistry.js';
import type { UniversalAgentEventBus } from './AgentEventBus.js';
import type { ExecutionStore } from './ExecutionStore.js';
import type { UniversalAgentRuntime } from './AgentRuntime.js';

export interface UniversalAgentTask {
  id?: string;
  request: AgentRequest;
  requirements?: AgentCapabilityRequirements;
  preferredAgentId?: string;
  maxAttempts?: number;
  priority?: number;
  strictAgentId?: boolean;
}

export interface UniversalAgentExecution {
  id: string;
  taskId: string;
  agentId: string;
  startedAt: number;
  finishedAt: number;
  response: AgentResponse;
  match: AgentMatch;
}

export class UniversalAgentScheduler {
  private readonly matcher = new CapabilityMatcher();
  private readonly active = new Map<string, Promise<UniversalAgentExecution>>();
  private readonly perAgent = new Map<string, number>();
  private readonly runtimes = new Map<string, UniversalAgentRuntime>();
  private readonly maxConcurrent: number;
  private activeSlots = 0;

  constructor(
    private readonly registry: UniversalAgentRegistry,
    private readonly events?: UniversalAgentEventBus,
    private readonly options: { maxConcurrent?: number; maxPerAgent?: number; store?: ExecutionStore } = {},
  ) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 8);
  }

  async execute(task: UniversalAgentTask): Promise<UniversalAgentExecution> {
    if (this.activeSlots >= this.maxConcurrent) throw new Error('Universal agent scheduler capacity exhausted');
    this.activeSlots++;

    try {
      const definitions = this.registry.list().filter(agent => agent.capabilities.interactive || agent.capabilities.headless);
      const requirements = {
        ...task.requirements,
        preferredAgentIds: [task.preferredAgentId, ...(task.requirements?.preferredAgentIds ?? [])].filter(Boolean) as string[],
      };
      const matches = this.matcher.match(definitions, requirements)
        .sort((a, b) => b.score - a.score)
        .filter(match => !task.strictAgentId || match.agent.id === task.preferredAgentId);

      let lastError = 'No universal agent satisfies the task requirements';
      if (task.strictAgentId && !task.preferredAgentId) {
        throw new Error('strictAgentId requires preferredAgentId');
      }

      for (const match of matches) {
        const count = this.perAgent.get(match.agent.id) ?? 0;
        if (count >= (this.options.maxPerAgent ?? 2)) {
          lastError = `Agent ${match.agent.id} concurrency limit reached`;
          continue;
        }

        const health = await this.registry.health(match.agent.id);
        this.events?.emitEvent({
          type: 'agent:health',
          agentId: match.agent.id,
          ready: health.ready,
          authenticated: health.authenticated,
          timestamp: Date.now(),
        });
        if (!health.ready) {
          lastError = `Agent ${match.agent.id} is not ready: ${health.checks.find(check => !check.ok)?.detail ?? 'unknown readiness failure'}`;
          if (task.strictAgentId) {
            this.events?.emitEvent({ type: 'agent:authentication-required', agentId: match.agent.id, timestamp: Date.now() });
            break;
          }
          continue;
        }

        const taskId = task.id ?? randomUUID();
        const executionId = randomUUID();
        const startedAt = Date.now();
        this.perAgent.set(match.agent.id, count + 1);
        this.events?.emitEvent({ type: 'agent:state-changed', agentId: match.agent.id, sessionId: executionId, state: 'starting', timestamp: startedAt });

        const promise = (async () => {
          const runtime = this.registry.createRuntime(match.agent.id, {
            workingDir: task.request.workingDir,
            timeoutMs: task.request.timeoutMs,
            events: this.events,
            store: this.options.store,
          });
          this.runtimes.set(executionId, runtime);
          const response = await runtime.execute(task.request);
          return { id: executionId, taskId, agentId: match.agent.id, startedAt, finishedAt: Date.now(), response, match };
        })();

        this.active.set(executionId, promise);
        try {
          return await promise;
        } finally {
          this.active.delete(executionId);
          this.runtimes.delete(executionId);
          this.perAgent.set(match.agent.id, Math.max(0, (this.perAgent.get(match.agent.id) ?? 1) - 1));
        }
      }

      throw new Error(lastError);
    } finally {
      this.activeSlots = Math.max(0, this.activeSlots - 1);
    }
  }

  getActiveExecutionCount(): number { return this.active.size; }
  getAgentConcurrency(agentId: string): number { return this.perAgent.get(agentId) ?? 0; }

  async stop(executionId: string): Promise<void> {
    const runtime = this.runtimes.get(executionId);
    if (!runtime) return;
    const session = runtime.getSessions().find(item => item.status === 'running' || item.status === 'starting');
    if (session) await runtime.stop(session.id);
  }
}
