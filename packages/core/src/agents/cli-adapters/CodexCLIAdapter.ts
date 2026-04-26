import { CLIAdapter, type CLIAdapterConfig } from './CLIAdapter.js';
import { AgentCapability } from '../../protocols/agent-protocol.js';
import type { Task } from '../../schemas/task.js';

export class CodexCLIAdapter extends CLIAdapter {
  constructor(
    agentId: string,
    terminalOrchestrator: any,
    config: Partial<CLIAdapterConfig> = {}
  ) {
    super(
      agentId,
      'Codex CLI',
      terminalOrchestrator,
      { cliPath: config.cliPath || 'codex', ...config }
    );
  }

  getCapabilities(): AgentCapability[] {
    return ['code-generation', 'analysis'];
  }

  buildCommand(task: Task, context: Record<string, unknown>): string {
    const prompt = (task.description || task.title).replace(/"/g, '\\"');
    const files = Array.isArray(context.files) ? (context.files as string[]).join(' ') : '';
    return `${this.getConfig().cliPath} "${prompt}" ${files} --json`.trim();
  }

  parseArtifacts(output: string): string[] {
    try {
      const json = JSON.parse(output);
      return json.files || [];
    } catch {
      const filePattern = /(?:Created|Wrote|File)\s+["']?([^"'\s]+\.[^"'\s]+)["']?/gi;
      const matches = [...output.matchAll(filePattern)];
      return matches.map(m => m[1]);
    }
  }
}