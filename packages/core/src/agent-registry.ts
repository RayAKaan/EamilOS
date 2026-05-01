import { AgentDefinition } from './types.js';
import { Logger, getLogger } from './logger.js';
import { getCommsGround } from './collaboration/CommsGround.js';
import { TerminalOrchestrator } from './execution/TerminalOrchestrator.js';
import { CommsGround } from './collaboration/CommsGround.js';
import { CLIAdapter, ClaudeCLIAdapter, CodexCLIAdapter } from './agents/cli-adapters/index.js';
import { autoDiscovery } from './auto-discovery.js';

export class AgentRegistry {
  private agents: Map<string, AgentDefinition> = new Map();
  private agentSessions: Map<string, string> = new Map();
  private cliAdapters: Map<string, CLIAdapter> = new Map();
  private logger: Logger;
  private commsGround: CommsGround;
  private terminalOrchestrator?: TerminalOrchestrator;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor() {
    this.logger = getLogger();
    this.commsGround = getCommsGround();
    this.loadBuiltInAgents();
  }

  setTerminalOrchestrator(orchestrator: TerminalOrchestrator): void {
    this.terminalOrchestrator = orchestrator;
  }

  async createCLIAgent(
    type: 'claude' | 'codex',
    agentId?: string
  ): Promise<string> {
    if (!this.terminalOrchestrator) {
      throw new Error('TerminalOrchestrator not set. Call setTerminalOrchestrator() first.');
    }

    const id = agentId || `${type}-agent-${Date.now()}`;
    
    let adapter: CLIAdapter;
    switch (type) {
      case 'claude':
        adapter = new ClaudeCLIAdapter(id, this.terminalOrchestrator);
        break;
      case 'codex':
        adapter = new CodexCLIAdapter(id, this.terminalOrchestrator);
        break;
      default:
        throw new Error(`Unknown CLI agent type: ${type}`);
    }

    await adapter.initialize();
    
    this.cliAdapters.set(id, adapter);

    const sessionId = this.commsGround.createSession([id]);
    this.agentSessions.set(id, sessionId);

    this.logger.info(`Created CLI agent: ${id} (${type})`);
    return id;
  }

  getCLIAgent(agentId: string): CLIAdapter | undefined {
    return this.cliAdapters.get(agentId);
  }

  getAllCLIAdapters(): CLIAdapter[] {
    return Array.from(this.cliAdapters.values());
  }

  private loadBuiltInAgents(): void {
    this.logger.debug('Loading built-in agents');
  }

  async autoRegisterFromDiscovery(): Promise<number> {
    const result = await autoDiscovery.discoverAll();
    const definitions = autoDiscovery.toAgentDefinitions();
    
    let registered = 0;
    for (const definition of definitions) {
      if (!this.agents.has(definition.id)) {
        this.registerAgent(definition);
        registered++;
        this.logger.info(`Auto-registered agent: ${definition.id} (${definition.name})`);
      }
    }
    
    this.logger.info(
      `Discovery: ${result.validAgents} valid, ${result.invalidAgents} invalid, ${result.yamlAgents.length} YAML agents loaded`
    );
    
    return registered;
  }

  async checkAgentsHealth(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    
    for (const [id] of this.agents) {
      const health = await autoDiscovery.checkHealth(id);
      results.set(id, health);
    }
    
    return results;
  }

  startHealthMonitoring(intervalMs: number = 30000): void {
    if (this.healthCheckInterval) return;
    
    this.healthCheckInterval = setInterval(async () => {
      await this.checkAgentsHealth();
    }, intervalMs);
    
    this.logger.info(`Health monitoring started (interval: ${intervalMs}ms)`);
  }

  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
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
