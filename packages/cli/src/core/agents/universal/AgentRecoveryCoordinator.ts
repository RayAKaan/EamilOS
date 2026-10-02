import { UniversalAgentRegistry } from './UniversalAgentRegistry.js';
import { UniversalAgentScheduler, type UniversalAgentTask } from './UniversalAgentScheduler.js';
import type { AgentResponse } from '../types.js';
import type { UniversalAgentEventBus } from './AgentEventBus.js';
import { ExecutionStore } from './ExecutionStore.js';

export interface RecoveryAttempt { attempt: number; agentId: string; success: boolean; error?: string; checkpointed: boolean; }
export interface RecoveryResult { success: boolean; response?: AgentResponse; attempts: RecoveryAttempt[]; recoveredFrom?: string; }

export class AgentRecoveryCoordinator {
  constructor(private readonly registry: UniversalAgentRegistry, private readonly events?: UniversalAgentEventBus, private readonly store = new ExecutionStore()) {}

  async recover(task: UniversalAgentTask, maxAttempts = task.maxAttempts ?? 3): Promise<RecoveryResult> {
    const attempts: RecoveryAttempt[] = [];
    const tried = new Set<string>();
    const originalPrompt = task.request.prompt;
    let checkpoint = '';
    const candidates = this.registry.list();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const remaining = candidates.filter(agent => !tried.has(agent.id));
      if (!remaining.length) break;
      const preferred = task.preferredAgentId && !tried.has(task.preferredAgentId) ? task.preferredAgentId : undefined;
      const localRegistry = new UniversalAgentRegistry(remaining);
      const scheduler = new UniversalAgentScheduler(localRegistry, this.events, { maxConcurrent: 1, maxPerAgent: 1, store: this.store });
      const request = { ...task.request, prompt: checkpoint ? `${originalPrompt}\n\nRecovery context from previous execution:\n${checkpoint.slice(-12000)}` : originalPrompt };
      try {
        const result = await scheduler.execute({ ...task, request, preferredAgentId: preferred });
        tried.add(result.agentId);
        const success = result.response.success;
        if (!success) checkpoint = result.response.rawOutput ?? result.response.content ?? checkpoint;
        attempts.push({ attempt, agentId: result.agentId, success, error: result.response.error, checkpointed: Boolean(checkpoint) });
        if (success) return { success: true, response: result.response, attempts, recoveredFrom: attempt > 1 ? attempts[attempt - 2]?.agentId : undefined };
      } catch (error) {
        const agentId = preferred ?? remaining[0].id;
        tried.add(agentId);
        checkpoint = error instanceof Error ? error.message : String(error);
        attempts.push({ attempt, agentId, success: false, error: checkpoint, checkpointed: true });
        this.events?.emitEvent({ type: 'agent:recovery-requested', agentId, reason: checkpoint, timestamp: Date.now() });
      }
    }
    return { success: false, attempts };
  }
}
