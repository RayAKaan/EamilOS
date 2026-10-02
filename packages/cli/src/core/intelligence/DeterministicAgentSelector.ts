import type { DecisionContext, TaskSummary } from './types.js';

export interface AgentSelection {
  agentId?: string;
  harnessId?: string;
  score: number;
  reasons: string[];
}

export class DeterministicAgentSelector {
  select(context: DecisionContext, task: Pick<TaskSummary, 'requiredCapabilities' | 'priority'> | undefined): AgentSelection {
    const required = new Set(task?.requiredCapabilities ?? []);
    const candidates = context.agents
      .filter(agent => ['AVAILABLE', 'READY', 'healthy', 'HEALTHY'].includes(agent.status) || ['AVAILABLE', 'READY', 'healthy', 'HEALTHY'].includes(agent.health))
      .map(agent => {
        const matches = [...required].filter(capability => agent.capabilities.includes(capability)).length;
        const missing = [...required].filter(capability => !agent.capabilities.includes(capability));
        const score = required.size === 0 ? 50 : Math.round((matches / required.size) * 100);
        return {
          agentId: agent.id,
          harnessId: agent.harness,
          score,
          missing,
          reasons: [
            `capability-match=${matches}/${required.size}`,
            `health=${agent.health}`,
            `status=${agent.status}`,
          ],
        };
      })
      .filter(candidate => candidate.score === 100 || required.size === 0)
      .sort((a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId));

    const selected = candidates[0];
    if (!selected) {
      return {
        score: 0,
        reasons: required.size
          ? [`No healthy agent satisfies required capabilities: ${[...required].join(', ')}.`]
          : ['No healthy execution agent is currently available.'],
      };
    }
    return { agentId: selected.agentId, harnessId: selected.harnessId, score: selected.score, reasons: selected.reasons };
  }

  inferCapabilities(text: string): string[] {
    const value = text.toLowerCase();
    const capabilities = new Set<string>();
    if (/test|spec|coverage|verify|validation/.test(value)) capabilities.add('testing');
    if (/debug|bug|fix|error|failure/.test(value)) capabilities.add('debugging');
    if (/research|investigate|analy[sz]e|compare/.test(value)) capabilities.add('research');
    if (/frontend|ui|ux|react|css|component/.test(value)) capabilities.add('frontend');
    if (/backend|api|server|database|sql/.test(value)) capabilities.add('backend');
    if (/docs|documentation|readme/.test(value)) capabilities.add('documentation');
    if (/security|audit|vulnerab/.test(value)) capabilities.add('security');
    return [...capabilities].sort();
  }
}
