import { AgentDefinition } from './types.js';
import { Logger, getLogger } from './logger.js';
import { UNIVERSAL_AGENT_CATALOG } from './agents/universal/catalog.js';

export class AgentRegistry {
  private agents: Map<string, AgentDefinition> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = getLogger();
    this.loadBuiltInAgents();
  }

  private loadBuiltInAgents(): void {
    for (const agent of UNIVERSAL_AGENT_CATALOG) {
      const capabilities = Object.entries(agent.capabilities).filter(([, enabled]) => enabled).map(([key]) => key);
      this.agents.set(agent.id, {
        id: agent.id,
        name: agent.name,
        role: 'universal-worker',
        source: 'prebuilt',
        systemPrompt: `EamilOS universal worker: ${agent.name}`,
        capabilities,
        preferredTier: agent.integrationStatus === 'production' ? 'strong' : 'cheap',
        tools: agent.protocols,
        maxTokens: 8192,
        temperature: 0.2,
        permissions: {
          fileRead: agent.capabilities.fileEditing || agent.capabilities.codeGeneration,
          fileWrite: agent.capabilities.fileEditing,
          fileDelete: false,
          commandExecute: agent.capabilities.commandExecution,
          networkRead: agent.capabilities.webResearch || agent.capabilities.browser,
          networkWrite: false,
        },
        timeoutSeconds: 300,
        maxRetries: 3,
      });
    }
    this.logger.debug(`Loaded ${this.agents.size} universal agents`);
  }

  registerAgent(agent: AgentDefinition): void { this.agents.set(agent.id, agent); }
  getAgent(id: string): AgentDefinition | undefined { return this.agents.get(id); }
  getAllAgents(): AgentDefinition[] { return Array.from(this.agents.values()); }

  findBestAgent(_taskType: string, requiredCapabilities?: string[]): AgentDefinition | undefined {
    const agents = this.getAllAgents();
    const matching = agents.filter((agent) => !requiredCapabilities?.length || requiredCapabilities.every((cap) => agent.capabilities.includes(cap)));
    return matching[0];
  }
}

let globalAgentRegistry: AgentRegistry | null = null;
export function initAgentRegistry(): AgentRegistry { globalAgentRegistry = new AgentRegistry(); return globalAgentRegistry; }
export function getAgentRegistry(): AgentRegistry { return globalAgentRegistry ?? initAgentRegistry(); }
