import {
  AdaptiveMultiplexer,
  getAdaptiveMultiplexer,
  type AgentTerminalDef,
  type TerminalEnvironment,
} from '../terminal/index.js';

export type { TerminalEnvironment };

export interface MultiplexerOptions {
  agents: { name: string; command: string; args: string[] }[];
  task: string;
  workingDir?: string;
}

export function detectEnvironment(): TerminalEnvironment {
  return AdaptiveMultiplexer.detectEnvironment();
}

export function canMultiplex(): boolean {
  return AdaptiveMultiplexer.isMultiplexingSupported();
}

export async function spawnSplitTerminals(options: MultiplexerOptions): Promise<void> {
  if (!canMultiplex()) {
    console.log('No multiplex-capable terminal detected. Use single viewport mode.');
    return;
  }

  const terminals: AgentTerminalDef[] = options.agents.map((agent, index) => ({
    id: agent.name,
    callsign: callsignForIndex(index),
    command: agent.command,
    args: agent.args,
    cwd: options.workingDir,
  }));

  await getAdaptiveMultiplexer().spawnAgentTerminals(terminals, options.workingDir);
}

function callsignForIndex(index: number): string {
  const callsigns = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];
  return callsigns[index] ?? `Agent-${index + 1}`;
}
