import { UniversalAgentRegistry } from './UniversalAgentRegistry.js';
import { UniversalAgentScheduler, type UniversalAgentTask } from './UniversalAgentScheduler.js';
import type { AgentResponse } from '../types.js';
import type { UniversalAgentEventBus } from './AgentEventBus.js';
import { ExecutionStore } from './ExecutionStore.js';

export interface RecoveryAttempt {
  attempt: number;
  agentId: string;
  success: boolean;
  error?: string;
  checkpointed: boolean;
  executionId?: string;
}

export interface RecoveryResult {
  success: boolean;
  response?: AgentResponse;
  attempts: RecoveryAttempt[];
  recoveredFrom?: string;
}

export class AgentRecoveryCoordinator {
  constructor(
    private readonly registry: UniversalAgentRegistry,
    private readonly events?: UniversalAgentEventBus,
    private readonly store = new ExecutionStore(),
  ) {}

  async recover(task: UniversalAgentTask, maxAttempts = task.maxAttempts ?? 3): Promise<RecoveryResult> {
    if (!this.store.isLoaded()) await this.store.load();

    const attempts: RecoveryAttempt[] = [];
    const tried = new Set<string>();
    const originalPrompt = task.request.prompt;
    let checkpoint = '';
    const candidates = this.registry.list();

    for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
      const remaining = candidates.filter(agent => !tried.has(agent.id));
      if (!remaining.length) break;

      const preferred = attempt === 1 && task.preferredAgentId && !tried.has(task.preferredAgentId)
        ? task.preferredAgentId
        : undefined;
      const localRegistry = new UniversalAgentRegistry(remaining);
      const scheduler = new UniversalAgentScheduler(localRegistry, this.events, {
        maxConcurrent: 1,
        maxPerAgent: 1,
        store: this.store,
      });
      const request = {
        ...task.request,
        id: task.request.id ?? task.id,
        prompt: checkpoint
          ? `${originalPrompt}\n\nRecovery context from previous execution:\n${checkpoint.slice(-12000)}`
          : originalPrompt,
      };

      this.events?.emitEvent({
        type: 'agent:state-changed',
        agentId: preferred ?? remaining[0].id,
        sessionId: task.id ?? request.id ?? 'recovery',
        state: 'recovering',
        timestamp: Date.now(),
      });

      try {
        const result = await scheduler.execute({
          ...task,
          request,
          preferredAgentId: preferred,
          strictAgentId: Boolean(preferred),
        });
        tried.add(result.agentId);

        const response = result.response;
        if (!response.success) {
          const output = response.rawOutput ?? response.content ?? response.error ?? '';
          await this.store.checkpoint(result.id, output);
          checkpoint = this.store.getCheckpoint(result.id) ?? output;
        }

        const recovered = response.success && attempt > 1;
        attempts.push({
          attempt,
          agentId: result.agentId,
          success: response.success,
          error: response.error,
          checkpointed: Boolean(checkpoint),
          executionId: result.id,
        });

        if (response.success) {
          return {
            success: true,
            response,
            attempts,
            recoveredFrom: recovered ? attempts[attempt - 2]?.agentId : undefined,
          };
        }

        this.events?.emitEvent({
          type: 'agent:recovery-requested',
          agentId: result.agentId,
          reason: response.error ?? 'agent execution failed',
          timestamp: Date.now(),
        });
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
