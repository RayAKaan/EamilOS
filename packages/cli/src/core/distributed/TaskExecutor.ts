import { EventEmitter } from 'events';
import { AgentFactory } from '../agents/AgentFactory.js';
import type { NetworkManager } from './NetworkManager.js';
import type { RemoteTaskPayload, RemoteTaskResult, TaskStreamPayload } from './types.js';
import type { AgentRequest, AgentResponse } from '../agents/types.js';
import type { EamilOSAgent } from '../agents/EamilOSAgent.js';
import { NodeCapabilityScanner } from './NodeCapabilityScanner.js';

/**
 * TaskExecutor runs on the WORKER node.
 * It receives a RemoteTaskPayload, spawns the requested CLI agent,
 * streams stdout chunks back as task:stream messages,
 * and sends the final result as task:result or task:error.
 *
 * API keys NEVER leave the worker — agents execute locally.
 */
export class TaskExecutor extends EventEmitter {
  private networkManager: NetworkManager;
  private activeAgents: Map<string, EamilOSAgent> = new Map();

  constructor(networkManager: NetworkManager) {
    super();
    this.networkManager = networkManager;
  }

  /**
   * Main entry point — called when the worker receives a task:assign message.
   */
  async execute(
    payload: RemoteTaskPayload,
    controllerSocket: unknown
  ): Promise<void> {
    const { taskId, agent, task, contextMessages, executionConfig } = payload;
    const startTime = Date.now();

    // ── Capacity check ──
    const capabilities = await NodeCapabilityScanner.scan();
    if (this.activeTaskCount >= capabilities.maxConcurrentTasks) {
      this.networkManager.sendMessage(controllerSocket, 'task:rejected', {
        taskId,
        reason: 'capacity_full',
        details: `Worker at capacity (${this.activeTaskCount}/${capabilities.maxConcurrentTasks})`,
      });
      return;
    }

    // ── Model check ──
    if (agent.model) {
      const hasModel = capabilities.models.some(m => m.modelId === agent.model);
      if (!hasModel) {
        this.networkManager.sendMessage(controllerSocket, 'task:rejected', {
          taskId,
          reason: 'model_unavailable',
          details: `Model '${agent.model}' not available on this worker`,
        });
        return;
      }
    }

    // ── ACK receipt ──
    this.networkManager.sendMessage(controllerSocket, 'task:accepted', {
      taskId,
      nodeId: this.networkManager.identity_.id,
      acceptedAt: Date.now(),
    });

    // ── Emit start event (worker.ts already listens for this) ──
    this.networkManager.emit('worker:task-started', {
      taskId,
      agentId: agent.id,
      model: agent.model || 'default',
    });

    try {
      // ── Create agent instance via existing factory ──
      const agentInstance = AgentFactory.createAdapter(agent.id, {
        workingDir: process.cwd(),
        timeoutMs: executionConfig.timeout || 300000,
      });

      if (!agentInstance) {
        throw new Error(`Unknown agent type: ${agent.id}. Available: opencode, claude-code, gemini-cli, aider, goose, codex-cli`);
      }

      this.activeAgents.set(taskId, agentInstance);

      // ── Build prompt from context messages + task ──
      const prompt = contextMessages
        .map((m) => `${m.role}: ${m.content}`)
        .concat([`user: ${task.description}`])
        .join('\n');

      // ── Execute with streaming ──
      const request: AgentRequest = {
        id: `remote_${taskId}`,
        sessionId: `worker_session_${Date.now()}`,
        prompt,
        systemPrompt: '[EamilOS Remote Worker] Execute the following task precisely.',
        mode: 'execution',
        workingDir: process.cwd(),
        timeoutMs: executionConfig.timeout || 300000,
        onOutput: (chunk: string) => {
          // Stream EVERY chunk back to controller as task:stream
          this.networkManager.sendMessage(controllerSocket, 'task:stream', {
            taskId,
            token: chunk,
            timestamp: Date.now(),
          } as TaskStreamPayload);
        },
      };

      const response: AgentResponse = await agentInstance.run(request);

      // ── Send completion ──
      const result: RemoteTaskResult = {
        success: response.success,
        taskId,
        nodeId: this.networkManager.identity_.id,
        output: response.content,
        durationMs: Date.now() - startTime,
        tokensUsed: response.tokensUsed,
        model: agent.model,
      };

      this.networkManager.sendMessage(controllerSocket, 'task:result', result);

      // ── Emit completion event ──
      this.networkManager.emit('worker:task-completed', {
        taskId,
        agentId: agent.id,
        durationMs: Date.now() - startTime,
      });

    } catch (err) {
      // ── Error path ──
      const errorMsg = err instanceof Error ? err.message : String(err);

      const errorResult: RemoteTaskResult = {
        success: false,
        taskId,
        nodeId: this.networkManager.identity_.id,
        error: errorMsg,
        durationMs: Date.now() - startTime,
      };

      this.networkManager.sendMessage(controllerSocket, 'task:error', errorResult);

      this.networkManager.emit('worker:task-failed', {
        taskId,
        agentId: agent.id,
        error: errorMsg,
      });

      // Also emit the error so controller's TaskDistributor can reroute
      this.networkManager.emit('distribution:task-error', {
        taskId,
        error: errorMsg,
      });

    } finally {
      // ── Cleanup ──
      const activeAgent = this.activeAgents.get(taskId);
      if (activeAgent?.stop) {
        try { await activeAgent.stop(); } catch { /* ignore cleanup errors */ }
      }
      this.activeAgents.delete(taskId);
    }
  }

  /**
   * Cancel a running task.
   */
  async cancel(taskId: string): Promise<void> {
    const agent = this.activeAgents.get(taskId);
    if (agent?.stop) {
      await agent.stop();
    }
    this.activeAgents.delete(taskId);
  }

  /**
   * Check if a task is currently running.
   */
  isRunning(taskId: string): boolean {
    return this.activeAgents.has(taskId);
  }

  /**
   * Get count of active tasks (for capacity reporting).
   */
  get activeTaskCount(): number {
    return this.activeAgents.size;
  }
}
