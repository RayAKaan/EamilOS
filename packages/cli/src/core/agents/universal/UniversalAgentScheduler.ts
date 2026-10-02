import { randomUUID } from 'node:crypto';
import type { AgentRequest, AgentResponse } from '../types.js';
import { CapabilityMatcher, type AgentCapabilityRequirements, type AgentMatch } from './CapabilityMatcher.js';
import { UniversalAgentRegistry } from './UniversalAgentRegistry.js';

export interface UniversalAgentTask {
  id?: string;
  request: AgentRequest;
  requirements?: AgentCapabilityRequirements;
  preferredAgentId?: string;
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

  constructor(private readonly registry: UniversalAgentRegistry) {}

  async execute(task: UniversalAgentTask): Promise<UniversalAgentExecution> {
    const definitions = this.registry.list().filter((agent) => agent.capabilities.interactive || agent.capabilities.headless);
    const match = this.matcher.select(definitions, {
      ...task.requirements,
      preferredAgentIds: [task.preferredAgentId, ...(task.requirements?.preferredAgentIds ?? [])].filter(Boolean) as string[],
    });
    if (!match) throw new Error('No installed universal agent satisfies the task requirements');
    const health = await this.registry.health(match.agent.id);
    if (!health.ready) throw new Error('Agent ' + match.agent.id + ' is not ready: ' + (health.error ?? health.checks.find((check) => !check.ok)?.detail ?? 'unknown readiness failure'));

    const taskId = task.id ?? randomUUID();
    const executionId = randomUUID();
    const startedAt = Date.now();
    const promise = (async () => {
      const runtime = this.registry.createRuntime(match.agent.id, { workingDir: task.request.workingDir, timeoutMs: task.request.timeoutMs });
      const response = await runtime.execute(task.request);
      return { id: executionId, taskId, agentId: match.agent.id, startedAt, finishedAt: Date.now(), response, match };
    })();
    this.active.set(executionId, promise);
    try {
      return await promise;
    } finally {
      this.active.delete(executionId);
    }
  }

  getActiveExecutionCount(): number {
    return this.active.size;
  }
}
