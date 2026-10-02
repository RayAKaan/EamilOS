import type { AgentRequest, AgentResponse } from '../types.js';
import { UniversalAgentRegistry } from './UniversalAgentRegistry.js';
import { UniversalAgentScheduler, type UniversalAgentTask } from './UniversalAgentScheduler.js';

export interface RecoveryAttempt {
  attempt: number;
  agentId: string;
  success: boolean;
  error?: string;
}

export interface RecoveryResult {
  success: boolean;
  response?: AgentResponse;
  attempts: RecoveryAttempt[];
}

export class AgentRecoveryCoordinator {
  private readonly scheduler: UniversalAgentScheduler;

  constructor(private readonly registry: UniversalAgentRegistry) {
    this.scheduler = new UniversalAgentScheduler(registry);
  }

  async recover(task: UniversalAgentTask, maxAttempts = 3): Promise<RecoveryResult> {
    const attempts: RecoveryAttempt[] = [];
    const tried = new Set<string>();
    let lastResponse: AgentResponse | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const candidates = this.registry.list().filter((agent) => !tried.has(agent.id));
      const candidateTask = { ...task, requirements: { ...task.requirements } };
      const preferred = candidateTask.preferredAgentId && !tried.has(candidateTask.preferredAgentId) ? candidateTask.preferredAgentId : undefined;
      candidateTask.preferredAgentId = preferred;

      try {
        const result = await this.scheduler.execute(candidateTask);
        tried.add(result.agentId);
        lastResponse = result.response;
        attempts.push({ attempt, agentId: result.agentId, success: result.response.success, error: result.response.error });
        if (result.response.success) return { success: true, response: result.response, attempts };
      } catch (error) {
        const fallback = candidates.find((candidate) => !tried.has(candidate.id));
        const agentId = preferred ?? fallback?.id ?? 'none';
        if (agentId !== 'none') tried.add(agentId);
        attempts.push({ attempt, agentId, success: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return { success: false, response: lastResponse, attempts };
  }
}
