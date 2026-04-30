import { CLIAdapter, type CLIAdapterConfig } from './CLIAdapter.js';
import { AgentCapability } from '../../protocols/agent-protocol.js';
import type { Task } from '../../schemas/task.js';

export class ClaudeCLIAdapter extends CLIAdapter {
  constructor(
    agentId: string,
    terminalOrchestrator: any,
    config: Partial<CLIAdapterConfig> = {}
  ) {
    super(
      agentId,
      'Claude CLI',
      terminalOrchestrator,
      { cliPath: config.cliPath || 'claude', ...config }
    );
  }

  getCapabilities(): AgentCapability[] {
    return ['reasoning', 'writing', 'analysis'];
  }

  buildCommand(task: Task, _context: Record<string, unknown>): string {
    const prompt = (task.description || task.title).replace(/"/g, '\\"');
    return `${this.getConfig().cliPath} --prompt "${prompt}" --max-tokens 4000`;
  }

  parseArtifacts(output: string): string[] {
    const filePattern = /(?:Created|Modified|Updated|wrote)\s+([^\s]+\.[^\s]+)/gi;
    const matches = [...output.matchAll(filePattern)];
    return matches.map(m => m[1]);
  }
}
