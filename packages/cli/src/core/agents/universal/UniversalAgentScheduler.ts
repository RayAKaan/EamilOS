import { randomUUID } from 'node:crypto';
import type { AgentRequest, AgentResponse } from '../types.js';
import { CapabilityMatcher, type AgentCapabilityRequirements, type AgentMatch } from './CapabilityMatcher.js';
import { UniversalAgentRegistry } from './UniversalAgentRegistry.js';
import type { UniversalAgentEventBus } from './AgentEventBus.js';
import { ExecutionStore } from './ExecutionStore.js';

export interface UniversalAgentTask {
  id?: string; request: AgentRequest; requirements?: AgentCapabilityRequirements; preferredAgentId?: string;
  maxAttempts?: number; priority?: number; strictAgentId?: boolean;
}
export interface UniversalAgentExecution {
  id: string; taskId: string; agentId: string; startedAt: number; finishedAt: number; response: AgentResponse; match: AgentMatch;
}

export class UniversalAgentScheduler {
  private readonly matcher = new CapabilityMatcher();
  private readonly active = new Map<string, Promise<UniversalAgentExecution>>();
  private readonly perAgent = new Map<string, number>();
  private readonly maxConcurrent: number;

  constructor(
    private readonly registry: UniversalAgentRegistry,
    private readonly events?: UniversalAgentEventBus,
    private readonly options: { maxConcurrent?: number; maxPerAgent?: number; store?: ExecutionStore } = {},
  ) { this.maxConcurrent = options.maxConcurrent ?? 8; }

  async execute(task: UniversalAgentTask): Promise<UniversalAgentExecution> {
    if (this.active.size >= this.maxConcurrent) throw new Error('Universal agent scheduler capacity exhausted');
    const definitions = this.registry.list().filter(agent => agent.capabilities.interactive || agent.capabilities.headless);
    const requirements = {
      ...task.requirements,
      preferredAgentIds: [task.preferredAgentId, ...(task.requirements?.preferredAgentIds ?? [])].filter(Boolean) as string[],
    };
    const candidates = this.matcher.match(definitions, requirements).sort((a,b) => b.score - a.score).filter(match => !task.strictAgentId || match.agent.id === task.preferredAgentId);
    let lastError = 'No universal agent satisfies the task requirements';

    for (const match of candidates) {
      const count = this.perAgent.get(match.agent.id) ?? 0;
      if (count >= (this.options.maxPerAgent ?? 2)) continue;
      const health = await this.registry.health(match.agent.id);
      this.events?.emitEvent({ type: 'agent:health', agentId: match.agent.id, ready: health.ready, authenticated: health.authenticated, timestamp: Date.now() });
      if (!health.ready) { lastError = `Agent ${match.agent.id} is not ready: ${health.checks.find(check => !check.ok)?.detail ?? 'unknown readiness failure'}`; continue; }

      const taskId = task.id ?? randomUUID();
      const executionId = randomUUID();
      const startedAt = Date.now();
      this.perAgent.set(match.agent.id, count + 1);
      const promise = (async () => {
        const runtime = this.registry.createRuntime(match.agent.id, {
          workingDir: task.request.workingDir, timeoutMs: task.request.timeoutMs, events: this.events, store: this.options.store,
        });
        const response = await runtime.execute(task.request);
        return { id: executionId, taskId, agentId: match.agent.id, startedAt, finishedAt: Date.now(), response, match };
      })();
      this.active.set(executionId, promise);
      try { return await promise; }
      catch (error) { lastError = error instanceof Error ? error.message : String(error); throw error; }
      finally {
        this.active.delete(executionId);
        this.perAgent.set(match.agent.id, Math.max(0, (this.perAgent.get(match.agent.id) ?? 1) - 1));
      }
    }
    throw new Error(lastError);
  }

  getActiveExecutionCount(): number { return this.active.size; }
  getAgentConcurrency(agentId: string): number { return this.perAgent.get(agentId) ?? 0; }
}
