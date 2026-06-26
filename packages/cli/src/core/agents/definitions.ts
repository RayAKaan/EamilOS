export interface CliAgentDefinition {
  id: string;
  name: string;
  command: string;
  baseArgs: string[];
  runArgs: (prompt: string) => string[];
  versionArgs: string[];
  installCheck: string[];
}

export const CLI_AGENT_DEFINITIONS: CliAgentDefinition[] = [
  {
    id: 'opencode',
    name: 'OpenCode AI',
    command: 'npx',
    baseArgs: ['--no-install', 'opencode-ai'],
    runArgs: (prompt) => ['run', prompt],
    versionArgs: ['--no-install', 'opencode-ai', '--version'],
    installCheck: ['npx', '--no-install', 'opencode-ai', '--version'],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'npx',
    baseArgs: ['--yes', '@anthropic-ai/claude-code'],
    runArgs: (prompt) => ['--print', prompt],
    versionArgs: ['--no-install', '@anthropic-ai/claude-code', '--version'],
    installCheck: ['npx', '--no-install', '@anthropic-ai/claude-code', '--version'],
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    command: 'npx',
    baseArgs: ['--yes', '@google/gemini-cli'],
    runArgs: (prompt) => ['--print', prompt],
    versionArgs: ['--no-install', '@google/gemini-cli', '--version'],
    installCheck: ['npx', '--no-install', '@google/gemini-cli', '--version'],
  },
  {
    id: 'aider',
    name: 'Aider',
    command: 'aider',
    baseArgs: [],
    runArgs: (prompt) => ['--message', prompt],
    versionArgs: ['--version'],
    installCheck: ['aider', '--version'],
  },
  {
    id: 'goose',
    name: 'Goose',
    command: 'npx',
    baseArgs: ['--no-install', '@block/goose'],
    runArgs: (prompt) => ['run', prompt],
    versionArgs: ['--no-install', '@block/goose', '--version'],
    installCheck: ['npx', '--no-install', '@block/goose', '--version'],
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    command: 'codex',
    baseArgs: [],
    runArgs: (prompt) => ['exec', '--prompt', prompt],
    versionArgs: ['--version'],
    installCheck: ['codex', '--version'],
  },
];

export function getAgentDefinition(agentId: string): CliAgentDefinition | undefined {
  return CLI_AGENT_DEFINITIONS.find(d => d.id === agentId);
}
