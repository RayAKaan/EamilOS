import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AuthenticationDefinition, UniversalAgentDefinition } from './types.js';

export type AgentAuthStatus = 'authenticated' | 'missing' | 'unknown';

export interface AgentAuthenticationResult {
  agentId: string; status: AgentAuthStatus; method?: AuthenticationDefinition['methods'][number];
  detail: string; checkedEnvironmentVariables: string[]; checkedConfigFiles: string[];
  loginCommand?: { executable: string; args: string[] };
}

const CONFIG_LOCATIONS: Record<string, string[]> = {
  'claude-code': ['.claude.json'], 'codex-cli': ['.codex/auth.json'], 'gemini-cli': ['.gemini/settings.json'],
  opencode: ['.config/opencode'], aider: ['.aider.conf.yml'], goose: ['.config/goose'],
  'openhands': ['.openhands'], 'pi': ['.pi'], 'cline-cli': ['.cline'],
};

const LOGIN_COMMANDS: Record<string, string[]> = {
  'claude-code': ['auth'], 'codex-cli': ['login'], 'gemini-cli': ['auth'], 'cline-cli': ['auth'],
  'github-copilot': ['auth'], 'amazon-q': ['login'], 'kiro-cli': ['login'],
};

export class AuthenticationManager {
  inspect(definition: UniversalAgentDefinition): AgentAuthenticationResult {
    const env = definition.authentication.environmentVariables ?? [];
    const present = env.find(key => Boolean(process.env[key]));
    const files = (CONFIG_LOCATIONS[definition.id] ?? []).map(path => join(homedir(), path));
    const config = files.find(path => existsSync(path));
    const loginCommand = LOGIN_COMMANDS[definition.id] ? {
      executable: definition.executableCandidates[0] ?? definition.id,
      args: LOGIN_COMMANDS[definition.id],
    } : undefined;

    if (present) return { agentId: definition.id, status: 'authenticated', method: 'environment', detail: 'Credential environment is configured', checkedEnvironmentVariables: env, checkedConfigFiles: files, loginCommand };
    if (config) return { agentId: definition.id, status: 'authenticated', method: 'config-file', detail: 'Agent configuration detected', checkedEnvironmentVariables: env, checkedConfigFiles: files, loginCommand };
    if (definition.authentication.methods.includes('none')) return { agentId: definition.id, status: 'authenticated', method: 'none', detail: 'Agent declares no authentication requirement', checkedEnvironmentVariables: env, checkedConfigFiles: files, loginCommand };
    if (env.length === 0 && files.length === 0 && !loginCommand) return { agentId: definition.id, status: 'unknown', detail: 'Authentication is managed by the native agent/provider flow', checkedEnvironmentVariables: env, checkedConfigFiles: files };
    return { agentId: definition.id, status: 'missing', detail: loginCommand ? 'Native login is required; use the provided login command' : 'No configured credential was detected', checkedEnvironmentVariables: env, checkedConfigFiles: files, loginCommand };
  }

  loginPlan(definition: UniversalAgentDefinition): { executable: string; args: string[] } | undefined {
    return this.inspect(definition).loginCommand;
  }

  inspectAll(definitions: UniversalAgentDefinition[]): AgentAuthenticationResult[] {
    return definitions.map(definition => this.inspect(definition));
  }
}
