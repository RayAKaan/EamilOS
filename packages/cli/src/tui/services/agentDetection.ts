import type { AgentEntry } from '../model.js';
import { AgentRegistry } from '../../core/agents/AgentRegistry.js';
import type { RegisteredAgent } from '../../core/agents/types.js';

export function createAgentRegistry(): AgentRegistry {
  return AgentRegistry.create();
}

export function agentEntryFromRegistered(agent: RegisteredAgent): AgentEntry {
  return {
    id: agent.id,
    name: agent.name,
    callsign: agent.id.toUpperCase().slice(0, 4),
    status: agent.status === 'available' ? 'ready' : 'not_installed',
    version: agent.version,
    error: agent.error,
  };
}

export async function runAgentDetection(
  registry: AgentRegistry,
  onAgent?: (entry: AgentEntry) => void,
): Promise<AgentRegistry> {
  await registry.detect({
    onAgent: (agent) => onAgent?.(agentEntryFromRegistered(agent)),
  });
  return registry;
}

export function assignCallsigns(agents: AgentEntry[]): AgentEntry[] {
  const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
  return agents.map((a, i) => ({
    ...a,
    callsign: names[i] ?? a.id.toUpperCase().slice(0, 4),
  }));
}
