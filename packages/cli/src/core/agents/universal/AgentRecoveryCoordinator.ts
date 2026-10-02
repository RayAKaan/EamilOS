import { UniversalAgentRegistry } from './UniversalAgentRegistry.js';
import { UniversalAgentScheduler, type UniversalAgentTask } from './UniversalAgentScheduler.js';
import type { AgentResponse } from '../types.js';

export interface RecoveryAttempt { attempt: number; agentId: string; success: boolean; error?: string; }
export interface RecoveryResult { success: boolean; response?: AgentResponse; attempts: RecoveryAttempt[]; }

export class AgentRecoveryCoordinator {
  constructor(private readonly registry: UniversalAgentRegistry) {}

  async recover(task: UniversalAgentTask, maxAttempts = 3): Promise<RecoveryResult> {
    const attempts: RecoveryAttempt[] = [];
    const tried = new Set<string>();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const remaining = this.registry.list().filter((agent) => !tried.has(agent.id));
      if (!remaining.length) break;
      const preferred = task.preferredAgentId && !tried.has(task.preferredAgentId) ? task.preferredAgentId : remaining[0].id;
      const localRegistry = new UniversalAgentRegistry(remaining);
      const scheduler = new UniversalAgentScheduler(localRegistry);
      try {
        const result = await scheduler.execute({ ...task, preferredAgentId: preferred });
        tried.add(result.agentId);
        attempts.push({ attempt, agentId: result.agentId, success: result.response.success, error: result.response.error });
        if (result.response.success) return { success: true, response: result.response, attempts };
      } catch (error) {
        tried.add(preferred);
        attempts.push({ attempt, agentId: preferred, success: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { success: false, attempts };
  }
}
