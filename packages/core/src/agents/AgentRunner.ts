import type { Task } from '../schemas/task.js';
import type { IAgentProtocol, ExecutionResult } from '../protocols/agent-protocol.js';

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
