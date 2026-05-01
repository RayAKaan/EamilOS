import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { AgentDefinition } from '../schemas/agent.js';
import { getLogger } from '../logger.js';

interface YamlAgentRaw {
  id?: string;
  name?: string;
  type?: string;
  capabilities?: string[];
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  systemPrompt?: string;
  preferredTier?: string;
  maxTokens?: number;
  temperature?: number;
  maxRetries?: number;
  timeoutSeconds?: number;
  permissions?: Partial<Record<string, boolean>>;
  tools?: string[];
  model?: string;
  endpoint?: string;
  apiKey?: string;
  healthEndpoint?: string;
}

export class YAMLLoader {
  private agentsDir: string;

  constructor() {
    this.agentsDir = path.join(os.homedir(), '.eamilos', 'agents');
  }

  async loadAgents(): Promise<AgentDefinition[]> {
    const logger = getLogger();
    try {
      fs.mkdirSync(this.agentsDir, { recursive: true });
    } catch {
      return [];
    }

    let files: string[];
    try {
      files = fs.readdirSync(this.agentsDir);
    } catch {
      return [];
    }

    const agentFiles = files.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    const configs: AgentDefinition[] = [];

    for (const file of agentFiles) {
      try {
        const filePath = path.join(this.agentsDir, file);
        const raw = this.parseFile(filePath);
        const def = this.toAgentDefinition(raw);
        configs.push(def);
        logger.info(`Loaded custom agent: ${def.id} from ${file}`);
      } catch (error) {
        logger.warn(`Failed to parse ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return configs;
  }

  private parseFile(filePath: string): YamlAgentRaw {
    const content = fs.readFileSync(filePath, 'utf-8');
    return yaml.load(content) as YamlAgentRaw;
  }

  private toAgentDefinition(raw: YamlAgentRaw): AgentDefinition {
    if (!raw.id || !raw.name) {
      throw new Error('Agent YAML missing required fields: id, name');
    }

    return {
      id: raw.id,
      name: raw.name,
      role: raw.type || 'custom',
      source: 'custom',
      systemPrompt: raw.systemPrompt || `You are ${raw.name}, a custom agent.`,
      capabilities: raw.capabilities && raw.capabilities.length > 0 ? raw.capabilities : ['general'],
      preferredTier: (raw.preferredTier as 'cheap' | 'strong') || 'strong',
      tools: raw.tools || [],
      maxTokens: raw.maxTokens || 4096,
      temperature: raw.temperature ?? 0.2,
      maxRetries: raw.maxRetries ?? 3,
      timeoutSeconds: raw.timeoutSeconds || 300,
      permissions: {
        fileRead: raw.permissions?.fileRead ?? true,
        fileWrite: raw.permissions?.fileWrite ?? true,
        fileDelete: raw.permissions?.fileDelete ?? false,
        commandExecute: raw.permissions?.commandExecute ?? false,
        networkRead: raw.permissions?.networkRead ?? false,
        networkWrite: raw.permissions?.networkWrite ?? false,
      },
    };
  }

  async createTemplate(name: string): Promise<string> {
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    const template = [
      '# EamilOS Custom Agent Template',
      `# Save as: ${slug}.yml in ~/.eamilos/agents/`,
      '',
      `id: ${slug}`,
      `name: ${name}`,
      'type: custom',
      '',
      '# Capabilities this agent provides',
      'capabilities:',
      '  - code-generation',
      '  - analysis',
      '',
      '# System prompt for the agent',
      'systemPrompt: "You are a custom agent."',
      '',
      '# Resource tier preference',
      'preferredTier: strong',
      '',
      '# Optional settings',
      '# maxTokens: 4096',
      '# temperature: 0.2',
      '# maxRetries: 3',
      '# timeoutSeconds: 300',
      '',
      '# Tools (if any)',
      '# tools:',
      '#   - file_read',
      '#   - file_write',
      '',
      '# Permissions',
      '# permissions:',
      '#   fileRead: true',
      '#   fileWrite: true',
      '#   fileDelete: false',
      '#   commandExecute: false',
      '#   networkRead: false',
      '#   networkWrite: false',
      '',
    ].join('\n');

    const filePath = path.join(this.agentsDir, `${slug}.yml`);
    fs.mkdirSync(this.agentsDir, { recursive: true });
    fs.writeFileSync(filePath, template, 'utf-8');

    return filePath;
  }
}

let globalYamlLoader: YAMLLoader | null = null;

export function initYamlLoader(): YAMLLoader {
  globalYamlLoader = new YAMLLoader();
  return globalYamlLoader;
}

export function getYamlLoader(): YAMLLoader | null {
  return globalYamlLoader;
}
