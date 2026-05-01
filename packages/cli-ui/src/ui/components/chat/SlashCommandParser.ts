import { getCommandByAlias, type SlashCommand } from '../../commands/slash-commands.js';

export interface ParsedSlashCommand {
  isCommand: boolean;
  command?: string;
  args: string[];
  handler?: string;
  definition?: SlashCommand;
  raw: string;
}

export function parseSlashCommand(input: string): ParsedSlashCommand {
  const raw = input.trim();
  if (!raw.startsWith('/')) {
    return { isCommand: false, args: [], raw };
  }

  const parts = raw.split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);
  const definition = getCommandByAlias(command);

  if (!definition) {
    return {
      isCommand: true,
      command,
      args,
      handler: 'unknown',
      raw,
    };
  }

  return {
    isCommand: true,
    command: definition.command,
    args,
    handler: definition.handler,
    definition,
    raw,
  };
}
