import { AgentDefinition } from './types.js';
import { Logger, getLogger } from './logger.js';
import { getCommsGround } from './collaboration/CommsGround.js';

export class AgentRegistry {
  private agents: Map<string, AgentDefinition> = new Map();
  private agentSessions: Map<string, string> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = getLogger();
    this.loadBuiltInAgents();
  }

  private loadBuiltInAgents(): void {
    this.logger.debug('Loading built-in agents');
  }

  registerAgent(agent: AgentDefinition): void {
    this.agents.set(agent.id, agent);
    const commsGround = getCommsGround();
    const sessionId = commsGround.createSession([agent.id]);
    this.agentSessions.set(agent.id, sessionId);
  }

  getAgent(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  getAgentSession(agentId: string): string | undefined {
    return this.agentSessions.get(agentId);
  }

  findBestAgent(
    _taskType: string,
    requiredCapabilities?: string[]
  ): AgentDefinition | undefined {
    const agents = this.getAllAgents();

    const matching = agents.filter((agent) => {
      if (requiredCapabilities && requiredCapabilities.length > 0) {
        return requiredCapabilities.every((cap) =>
          agent.capabilities.includes(cap)
        );
      }
      return true;
    });

    return matching[0];
  }
}

let globalAgentRegistry: AgentRegistry | null = null;

export function initAgentRegistry(): AgentRegistry {
  globalAgentRegistry = new AgentRegistry();
  return globalAgentRegistry;
}

export function getAgentRegistry(): AgentRegistry {
  if (!globalAgentRegistry) {
    return initAgentRegistry();
  }
  return globalAgentRegistry;
}
