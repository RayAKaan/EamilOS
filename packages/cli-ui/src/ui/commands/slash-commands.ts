export interface SlashCommand {
  command: string;
  description: string;
  handler: string;
  aliases: string[];
  examples?: string[];
}

export const SLASH_COMMANDS: Record<string, SlashCommand> = {
  '/help': {
    command: '/help',
    description: 'Show all commands and capabilities',
    handler: 'ui:help',
    aliases: ['/h', '/?'],
    examples: ['/help', '/h']
  },
  '/agents': {
    command: '/agents',
    description: 'List all available agents',
    handler: 'agents:list',
    aliases: ['/a'],
    examples: ['/agents', '/a']
  },
  '/models': {
    command: '/models',
    description: 'Show available models by capability',
    handler: 'models:list',
    aliases: ['/m'],
    examples: ['/models', '/m']
  },
  '/tasks': {
    command: '/tasks',
    description: 'Show task queue and status',
    handler: 'tasks:list',
    aliases: ['/t', '/status'],
    examples: ['/tasks', '/t']
  },
  '/new': {
    command: '/new',
    description: 'Start new session with clean context',
    handler: 'session:new',
    aliases: ['/clear', '/reset'],
    examples: ['/new', '/clear']
  },
  '/exit': {
    command: '/exit',
    description: 'Save session and exit',
    handler: 'system:exit',
    aliases: ['/quit', '/q'],
    examples: ['/exit', '/q']
  },
  '/editor': {
    command: '/editor',
    description: 'Open file in editor mode',
    handler: 'workspace:edit',
    aliases: ['/e', '/open'],
    examples: ['/editor src/index.ts']
  },
  '/find': {
    command: '/find',
    description: 'Search codebase using AI',
    handler: 'workspace:find',
    aliases: ['/grep', '/search'],
    examples: ['/find function auth']
  },
  '/compact': {
    command: '/compact',
    description: 'Compress context (token management)',
    handler: 'context:compress',
    aliases: ['/c'],
    examples: ['/compact']
  },
  '/pause': {
    command: '/pause',
    description: 'Pause current task',
    handler: 'task:pause',
    aliases: ['/stop'],
    examples: ['/pause']
  },
  '/resume': {
    command: '/resume',
    description: 'Resume paused task',
    handler: 'task:resume',
    aliases: [],
    examples: ['/resume task-123']
  },
  '/parallel': {
    command: '/parallel',
    description: 'Execute across all agents',
    handler: 'orchestration:parallel',
    aliases: ['/all'],
    examples: ['/parallel optimize the database']
  },
  '/delegate': {
    command: '/delegate',
    description: 'Send sub-task to specific agent',
    handler: 'orchestration:delegate',
    aliases: [],
    examples: ['/delegate claude refactor auth']
  },
  '/agent': {
    command: '/agent',
    description: 'Switch primary agent',
    handler: 'agent:switch',
    aliases: ['/use', '/switch'],
    examples: ['/agent claude', '/use codex']
  },
  '/config': {
    command: '/config',
    description: 'Show or modify configuration',
    handler: 'config:show',
    aliases: [],
    examples: ['/config', '/config model=gpt-4o']
  },
  '/cost': {
    command: '/cost',
    description: 'Show cost breakdown and budget status',
    handler: 'cost:report',
    aliases: ['/budget', '/spend'],
    examples: ['/cost', '/budget']
  },
  '/template': {
    command: '/template',
    description: 'List or execute project templates',
    handler: 'template:list',
    aliases: ['/templates', '/tpl'],
    examples: ['/template list', '/template use react-auth']
  },
  '/learning': {
    command: '/learning',
    description: 'Show what the system has learned',
    handler: 'learning:report',
    aliases: ['/learn', '/prefs', '/adapt'],
    examples: ['/learning', '/learning report']
  },
  '/profile': {
    command: '/profile',
    description: 'Switch active profile',
    handler: 'profile:switch',
    aliases: ['/p'],
    examples: ['/profile abc123']
  },
  '/teams': {
    command: '/teams',
    description: 'List your teams',
    handler: 'team:list',
    aliases: ['/team'],
    examples: ['/teams']
  },
  '/audit': {
    command: '/audit',
    description: 'Show recent audit log entries',
    handler: 'audit:log',
    aliases: ['/logs'],
    examples: ['/audit', '/audit 20']
  },
  '/health': {
    command: '/health',
    description: 'Show agent health status and monitoring report',
    handler: 'health:report',
    aliases: ['/status', '/agents-health'],
    examples: ['/health']
  },
  '/session': {
    command: '/session',
    description: 'Manage sessions (save, load, list, create)',
    handler: 'session:manage',
    aliases: ['/sess'],
    examples: ['/session save', '/session list', '/session load default', '/session new my-session']
  },
};

export function getCommandByAlias(input: string): SlashCommand | undefined {
  const normalized = input.trim().toLowerCase();
  
  for (const cmd of Object.values(SLASH_COMMANDS)) {
    if (cmd.command === normalized || cmd.aliases.includes(normalized)) {
      return cmd;
    }
  }
  
  return undefined;
}

export function matchCommands(filter: string): SlashCommand[] {
  if (!filter) return Object.values(SLASH_COMMANDS);
  
  const lower = filter.toLowerCase();
  return Object.values(SLASH_COMMANDS).filter(
    cmd => cmd.command.includes(lower) || cmd.description.toLowerCase().includes(lower)
  );
}

export function getHelpText(): string {
  const lines = [
    'EamilOS Slash Commands:',
    '',
  ];
  
  for (const cmd of Object.values(SLASH_COMMANDS)) {
    const aliases = cmd.aliases.length > 0 ? ` (${cmd.aliases.join(', ')})` : '';
    lines.push(`  ${cmd.command}${aliases}`);
    lines.push(`    ${cmd.description}`);
    if (cmd.examples && cmd.examples.length > 0) {
      lines.push(`    Example: ${cmd.examples[0]}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}