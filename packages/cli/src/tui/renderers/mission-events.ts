import type { AgentEvent } from '../events/agent-event.js';
import type { RuntimeEvent } from '../architecture/contracts.js';

export function summarizeAgentEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'MESSAGE': return event.agentId + ' / ' + event.content.replace(/\s+/g, ' ');
    case 'THINKING': return event.agentId + ' / ' + (event.label ?? 'working');
    case 'TOOL_CALL': return event.agentId + ' / ' + event.tool;
    case 'TOOL_RESULT': return event.tool + ' / ' + (event.success ? 'completed' : 'failed');
    case 'FILE_CHANGE': return event.path + ' / ' + event.action;
    case 'COMMAND': return '$ ' + event.command;
    case 'TEST': return event.name + ' / ' + event.status;
    case 'APPROVAL': return 'approval / ' + event.reason;
    case 'ERROR': return event.agentId + ' / ' + event.message;
    case 'COMPLETE': return event.agentId + ' / ' + (event.success ? 'completed' : 'failed');
  }
}

export function summarizeRuntimeEvent(event: RuntimeEvent): string {
  return event.type.replaceAll('_', ' ').toLowerCase();
}
