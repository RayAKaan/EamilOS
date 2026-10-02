import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AuthenticationDefinition, UniversalAgentDefinition } from './types.js';

export type AgentAuthStatus = 'authenticated' | 'missing' | 'unknown';

export interface AgentAuthenticationResult {
  agentId: string;
  status: AgentAuthStatus;
  method?: AuthenticationDefinition['methods'][number];
  detail: string;
  checkedEnvironmentVariables: string[];
  checkedConfigFiles: string[];
}

const CONFIG_LOCATIONS: Record<string, string[]> = {
  'claude-code': ['.claude.json'],
  'codex-cli': ['.codex/auth.json'],
  'gemini-cli': ['.gemini/settings.json'],
  opencode: ['.config/opencode'],
  aider: ['.aider.conf.yml'],
  goose: ['.config/goose'],
};

export class AuthenticationManager {
  inspect(definition: UniversalAgentDefinition): AgentAuthenticationResult {
    const env = definition.authentication.environmentVariables ?? [];
    const present = env.find((key) => Boolean(process.env[key]));
    const files = (CONFIG_LOCATIONS[definition.id] ?? []).map((path) => join(homedir(), path));
    const config = files.find((path) => existsSync(path));

    if (present) {
      return { agentId: definition.id, status: 'authenticated', method: 'environment', detail: present + ' is configured', checkedEnvironmentVariables: env, checkedConfigFiles: files };
    }
    if (config) {
      return { agentId: definition.id, status: 'authenticated', method: 'config-file', detail: 'Agent configuration detected', checkedEnvironmentVariables: env, checkedConfigFiles: files };
    }
    if (env.length === 0 && files.length === 0) {
      return { agentId: definition.id, status: 'unknown', detail: 'Authentication is managed by the agent or provider', checkedEnvironmentVariables: env, checkedConfigFiles: files };
    }
    return { agentId: definition.id, status: 'missing', detail: 'No configured credential was detected; use the agent native login flow', checkedEnvironmentVariables: env, checkedConfigFiles: files };
  }

  inspectAll(definitions: UniversalAgentDefinition[]): AgentAuthenticationResult[] {
    return definitions.map((definition) => this.inspect(definition));
  }
}
