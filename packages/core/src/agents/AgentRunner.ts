import type { Task } from '../schemas/task.js';
import type { IAgentProtocol, ExecutionResult } from '../protocols/agent-protocol.js';
import type { TerminalOrchestrator } from '../execution/TerminalOrchestrator.js';
import type { CLIAdapter } from './cli-adapters/CLIAdapter.js';

const TASK_TYPE_CAPABILITY_MAP: Record<string, ReturnType<IAgentProtocol['getCapabilities']>[number]> = {
  coding: 'code-generation',
  planning: 'reasoning',
  research: 'analysis',
  qa: 'analysis',
  design: 'writing',
  deploy: 'terminal',
  custom: 'reasoning',
};

export class AgentRunner {
  constructor(private agent: IAgentProtocol) {}

  async run(task: Task): Promise<ExecutionResult> {
    const mappedCapability = TASK_TYPE_CAPABILITY_MAP[task.type] || 'reasoning';
    if (!this.agent.getCapabilities().includes(mappedCapability)) {
      throw new Error(`Agent ${this.agent.getIdentity().id} lacks capability '${mappedCapability}'`);
    }
    return this.agent.execute(task, {});
  }
}

export interface CLIAgentResult {
  agentId: string;
  success: boolean;
  output?: string;
  artifacts?: string[];
  error?: string;
}

export type CLIAgentConfig = Record<string, unknown>;

export class CLIAgentRunner {
  constructor(
    private terminalOrchestrator: TerminalOrchestrator,
    private adapter: CLIAdapter
  ) {}

  async runAgent(task: Task, _agentConfig: CLIAgentConfig = {}): Promise<CLIAgentResult> {
    const agentId = this.adapter.getIdentity().id;
    const context = {
      workspace: process.cwd(),
      files: task.artifacts,
      inputContext: task.inputContext,
      existingSessionId: this.terminalOrchestrator.getSession(agentId)?.id,
    };

    const result = await this.adapter.execute(task, context);
    return {
      agentId,
      success: result.success,
      output: result.output,
      artifacts: result.artifacts,
      error: result.error,
    };
  }

  cleanup(): void {
    this.adapter.cleanup();
  }
}
