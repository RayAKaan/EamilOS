import type { AgentEntry } from '../model.js';
import { AgentRegistry } from '../../core/agents/AgentRegistry.js';

export async function runAgentDetection(): Promise<AgentEntry[]> {
  const registry = AgentRegistry.create();
  await registry.detect();

  const allAgents = registry.getAllAgents();
  const entries: AgentEntry[] = [];

  for (const agent of allAgents) {
    const entry: AgentEntry = {
      id: agent.id,
      name: agent.name,
      callsign: agent.id.toUpperCase().slice(0, 4),
      status: agent.status === 'available' ? 'ready' : 'not_installed',
      version: agent.version,
      error: agent.error,
    };
    entries.push(entry);
  }

  return entries;
}

export function assignCallsigns(agents: AgentEntry[]): AgentEntry[] {
  const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
  return agents.map((a, i) => ({
    ...a,
    callsign: names[i] ?? a.id.toUpperCase().slice(0, 4),
  }));
}
