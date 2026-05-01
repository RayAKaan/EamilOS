import { execSync } from 'child_process';
import { AgentDefinition } from './schemas/agent.js';
import { YAMLLoader } from './discovery/YAMLLoader.js';
import { HealthValidator } from './discovery/HealthValidator.js';
import { getLogger } from './logger.js';

export interface DiscoveredAgent {
  id: string;
  type: 'cli' | 'ollama' | 'cloud' | 'yaml';
  provider: string;
  name: string;
  status: 'available' | 'unhealthy' | 'not_found';
  health?: {
    latency: number;
    lastCheck: Date;
  };
  capabilities: string[];
  model?: string;
  endpoint?: string;
  apiKey?: string;
}

export interface DiscoveryResult {
  cliTools: DiscoveredAgent[];
  localModels: DiscoveredAgent[];
  cloudProviders: DiscoveredAgent[];
  yamlAgents: DiscoveredAgent[];
  validAgents: number;
  invalidAgents: number;
}

const CLI_TOOLS = [
  { id: 'claude', name: 'Claude CLI', capabilities: ['code', 'reasoning'] },
  { id: 'codex', name: 'OpenAI Codex', capabilities: ['code', 'fast'] },
  { id: 'gemini', name: 'Google Gemini', capabilities: ['multimodal', 'reasoning'] },
  { id: 'opencode', name: 'OpenCode', capabilities: ['code', 'chat'] },
  { id: 'ollama', name: 'Ollama', capabilities: ['code', 'local'] },
];

const CLOUD_PROVIDERS = [
  { 
    id: 'openai', 
    name: 'OpenAI', 
    envVar: 'OPENAI_API_KEY', 
    capabilities: ['code', 'reasoning', 'multimodal'],
    defaultModel: 'gpt-4o',
  },
  { 
    id: 'anthropic', 
    name: 'Anthropic', 
    envVar: 'ANTHROPIC_API_KEY', 
    capabilities: ['code', 'reasoning', 'writing'],
    defaultModel: 'claude-3-5-sonnet',
  },
  { 
    id: 'google', 
    name: 'Google AI', 
    envVar: 'GOOGLE_API_KEY', 
    capabilities: ['multimodal', 'reasoning'],
    defaultModel: 'gemini-2.0-flash',
  },
  { 
    id: 'deepseek', 
    name: 'DeepSeek', 
    envVar: 'DEEPSEEK_API_KEY', 
    capabilities: ['code', 'reasoning', 'low_cost'],
    defaultModel: 'deepseek-coder',
  },
  { 
    id: 'xai', 
    name: 'xAI', 
    envVar: 'XAI_API_KEY', 
    capabilities: ['code', 'reasoning'],
    defaultModel: 'grok-2',
  },
];

export class AutoDiscovery {
  private discoveredAgents: Map<string, DiscoveredAgent> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;
  private yamlLoader: YAMLLoader;
  private healthValidator: HealthValidator;

  constructor() {
    this.yamlLoader = new YAMLLoader();
    this.healthValidator = new HealthValidator();
  }

  async discoverAll(): Promise<DiscoveryResult> {
    this.discoveredAgents.clear();
    const logger = getLogger();

    const [cliTools, localModels, cloudProviders, yamlAgentConfigs] = await Promise.all([
      this.discoverCLITools(),
      this.discoverOllamaModels(),
      this.discoverCloudProviders(),
      this.yamlLoader.loadAgents(),
    ]);

    // Register YAML agents as discovered agents
    const yamlAgents: DiscoveredAgent[] = [];
    for (const config of yamlAgentConfigs) {
      const agent: DiscoveredAgent = {
        id: config.id,
        type: 'yaml',
        provider: 'yaml',
        name: config.name,
        status: 'available',
        capabilities: config.capabilities,
      };
      yamlAgents.push(agent);
      this.discoveredAgents.set(agent.id, agent);
      logger.info(`Discovered YAML agent: ${config.id}`);
    }

    // Validate all discovered agents
    const allAgents = this.getAll();
    logger.info('Running health validation on discovered agents...');
    const validationResults = await this.healthValidator.validateAll(allAgents);

    // Update status based on validation
    let validCount = 0;
    let invalidCount = 0;

    for (let i = 0; i < allAgents.length; i++) {
      const agent = allAgents[i];
      const result = validationResults[i];
      if (result.valid) {
        agent.status = 'available';
        validCount++;
      } else {
        agent.status = 'unhealthy';
        agent.health = { latency: result.latency || 0, lastCheck: new Date() };
        invalidCount++;
      }
    }

    if (invalidCount > 0) {
      logger.warn(`Excluded ${invalidCount} invalid agents from active pool`);
    }

    return {
      cliTools,
      localModels,
      cloudProviders,
      yamlAgents,
      validAgents: validCount,
      invalidAgents: invalidCount,
    };
  }

  async discoverCLITools(): Promise<DiscoveredAgent[]> {
    const found: DiscoveredAgent[] = [];
    for (const tool of CLI_TOOLS) {
      const status = await this.checkCLITool(tool.id);
      const agent: DiscoveredAgent = {
        id: tool.id,
        type: 'cli',
        provider: tool.id,
        name: tool.name,
        status: status === 'available' ? 'available' : 'not_found',
        capabilities: tool.capabilities,
      };
      this.discoveredAgents.set(agent.id, agent);
      if (agent.status === 'available') {
        found.push(agent);
      }
    }
    return found;
  }

  private async checkCLITool(toolId: string): Promise<string> {
    try {
      execSync(`${toolId} --version`, { stdio: 'ignore', timeout: 5000 });
      return 'available';
    } catch {
      return 'not_found';
    }
  }

  async discoverOllamaModels(): Promise<DiscoveredAgent[]> {
    const found: DiscoveredAgent[] = [];
    try {
      const response = await fetch('http://localhost:11434/api/tags', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      
      if (!response.ok) return found;

      const data = await response.json() as { models?: Array<{ name: string }> };
      const models = data.models || [];
      
      for (const model of models) {
        const modelName = model.name;
        const agentId = `ollama:${modelName}`;
        
        const capabilities = this.inferCapabilities(modelName);
        
        const agent: DiscoveredAgent = {
          id: agentId,
          type: 'ollama',
          provider: 'ollama',
          name: `Ollama: ${modelName}`,
          status: 'available',
          capabilities,
          model: modelName,
          endpoint: 'http://localhost:11434',
        };
        this.discoveredAgents.set(agentId, agent);
        found.push(agent);
      }
    } catch {
      // Ollama not running
    }
    return found;
  }

  private inferCapabilities(modelName: string): string[] {
    const name = modelName.toLowerCase();
    const capabilities: string[] = ['code'];
    
    if (name.includes('coder') || name.includes('code')) {
      capabilities.push('code_specialist');
    }
    if (name.includes('vision') || name.includes('vision')) {
      capabilities.push('multimodal');
    }
    if (name.includes('math') || name.includes('reason')) {
      capabilities.push('reasoning');
    }
    
    return capabilities;
  }

  async discoverCloudProviders(): Promise<DiscoveredAgent[]> {
    const found: DiscoveredAgent[] = [];
    for (const provider of CLOUD_PROVIDERS) {
      const apiKey = process.env[provider.envVar];
      
      if (!apiKey) continue;
      
      const agent: DiscoveredAgent = {
        id: provider.id,
        type: 'cloud',
        provider: provider.id,
        name: provider.name,
        status: 'available',
        capabilities: provider.capabilities,
        model: provider.defaultModel,
        apiKey: apiKey.substring(0, 8) + '...',
      };
      this.discoveredAgents.set(agent.id, agent);
      found.push(agent);
    }
    return found;
  }

  getAll(): DiscoveredAgent[] {
    return Array.from(this.discoveredAgents.values());
  }

  getAvailable(): DiscoveredAgent[] {
    return this.getAll().filter(a => a.status === 'available');
  }

  getById(id: string): DiscoveredAgent | undefined {
    return this.discoveredAgents.get(id);
  }

  getByType(type: DiscoveredAgent['type']): DiscoveredAgent[] {
    return this.getAll().filter(a => a.type === type);
  }

  getByCapability(capability: string): DiscoveredAgent[] {
    return this.getAvailable().filter(a => 
      a.capabilities.includes(capability)
    );
  }

  async checkHealth(agentId: string): Promise<boolean> {
    const agent = this.discoveredAgents.get(agentId);
    if (!agent) return false;

    const start = Date.now();
    
    try {
      if (agent.type === 'ollama' && agent.endpoint) {
        const response = await fetch(`${agent.endpoint}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        agent.status = response.ok ? 'available' : 'unhealthy';
      } else if (agent.type === 'cloud') {
        agent.status = 'available';
      } else if (agent.type === 'cli') {
        const status = await this.checkCLITool(agent.id);
        agent.status = status === 'available' ? 'available' : 'unhealthy';
      }
      
      agent.health = {
        latency: Date.now() - start,
        lastCheck: new Date(),
      };
      
      return agent.status === 'available';
    } catch {
      agent.status = 'unhealthy';
      return false;
    }
  }

  startHealthMonitoring(intervalMs: number = 30000): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      for (const agent of this.getAvailable()) {
        await this.checkHealth(agent.id);
      }
    }, intervalMs);
  }

  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  toAgentDefinitions(): AgentDefinition[] {
    return this.getAvailable().map(agent => ({
      id: agent.id,
      name: agent.name,
      role: agent.id,
      source: 'external' as const,
      systemPrompt: `You are ${agent.name} powered by ${agent.provider}.`,
      capabilities: agent.capabilities,
      preferredTier: agent.type === 'cloud' ? 'strong' : 'cheap',
      tools: [],
      maxTokens: 4096,
      maxRetries: 3,
      temperature: 0.2,
      permissions: {
        fileRead: true,
        fileWrite: true,
        fileDelete: false,
        commandExecute: agent.type !== 'cloud',
        networkRead: true,
        networkWrite: agent.type !== 'cli',
      },
      timeoutSeconds: 300,
    }));
  }

  getBestAgent(capabilities?: string[]): DiscoveredAgent | null {
    const available = this.getAvailable();
    
    let candidates = available;
    if (capabilities && capabilities.length > 0) {
      candidates = available.filter(a =>
        capabilities.every(cap => a.capabilities.includes(cap))
      );
    }

    if (candidates.length === 0) {
      return null;
    }

    // Priority: local (ollama) > cloud > yaml > cli
    return candidates.sort((a, b) => {
      const priority = { ollama: 0, cloud: 1, yaml: 2, cli: 3 };
      return priority[a.type] - priority[b.type];
    })[0];
  }
}

export const autoDiscovery = new AutoDiscovery();