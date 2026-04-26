import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '../../src/agents/AgentRunner.js';
import { ExecutionOrchestrator } from '../../src/execution/ExecutionOrchestrator.js';
import type {
  IAgentProtocol,
  ITerminalExecutionProtocol,
  AgentIdentity,
  AgentMessage,
  ExecutionResult,
  Context,
} from '../../src/protocols/index.js';
import type { Task } from '../../src/schemas/task.js';

describe('Protocol Compliance', () => {
  it('AgentRunner should work with any IAgentProtocol implementation', async () => {
    const mockAgent: IAgentProtocol = {
      getIdentity: (): AgentIdentity => ({
        id: 'agent-1',
        name: 'Mock Agent',
        type: 'custom',
        capabilities: ['code-generation'],
        health: {
          status: 'healthy',
          score: 100,
          lastCheck: Date.now(),
        },
        metadata: {},
      }),
      execute: vi.fn(async (_task: Task, _context: Context): Promise<ExecutionResult> => ({
        success: true,
        output: 'ok',
      })),
      communicate: vi.fn(async (_message: AgentMessage) => {}),
      getCapabilities: () => ['code-generation'],
    };

    const runner = new AgentRunner(mockAgent);
    const task = {
      id: 't1',
      projectId: 'p1',
      title: 'Build API',
      description: 'Create API',
      type: 'coding',
      status: 'ready',
      priority: 'medium',
      dependsOn: [],
      artifacts: [],
      retryCount: 0,
      maxRetries: 1,
      requiresHumanApproval: false,
      tokenUsage: 0,
      costUsd: 0,
      createdAt: new Date(),
    } as Task;

    const result = await runner.run(task);
    expect(result.success).toBe(true);
    expect(mockAgent.execute).toHaveBeenCalledTimes(1);
  });

  it('ExecutionOrchestrator should implement ITerminalExecutionProtocol', () => {
    const orchestrator = new ExecutionOrchestrator();
    const typed: ITerminalExecutionProtocol = orchestrator;
    const keys: (keyof ITerminalExecutionProtocol)[] = ['spawn', 'execute', 'executeParallel', 'cleanup'];
    keys.forEach((key) => expect(typeof typed[key]).toBe('function'));
  });
});
