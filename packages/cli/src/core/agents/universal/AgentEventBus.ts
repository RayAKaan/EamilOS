import { EventEmitter } from 'node:events';

export type UniversalAgentEvent =
  | { type: 'agent:detected'; agentId: string; version?: string; installed: boolean; timestamp: number }
  | { type: 'agent:health'; agentId: string; ready: boolean; authenticated: boolean | 'unknown'; timestamp: number }
  | { type: 'agent:session-started'; agentId: string; sessionId: string; terminalId: string; timestamp: number }
  | { type: 'agent:state-changed'; agentId: string; sessionId: string; state: 'starting'|'working'|'waiting'|'completed'|'failed'|'stopped'|'recovering'; timestamp: number }
  | { type: 'agent:output'; agentId: string; sessionId: string; data: string; timestamp: number }
  | { type: 'agent:waiting'; agentId: string; sessionId: string; reason: 'permission'|'question'|'authentication'|'input'; prompt?: string; timestamp: number }
  | { type: 'agent:permission-requested'; agentId: string; sessionId: string; prompt: string; timestamp: number }
  | { type: 'agent:question-requested'; agentId: string; sessionId: string; prompt: string; options?: string[]; timestamp: number }
  | { type: 'agent:authentication-required'; agentId: string; sessionId?: string; timestamp: number }
  | { type: 'agent:completed'; agentId: string; sessionId: string; success: boolean; timestamp: number }
  | { type: 'agent:failed'; agentId: string; sessionId: string; error: string; timestamp: number }
  | { type: 'agent:stopped'; agentId: string; sessionId: string; timestamp: number }
  | { type: 'agent:recovery-requested'; agentId: string; sessionId?: string; reason: string; timestamp: number };

export class UniversalAgentEventBus extends EventEmitter {
  emitEvent(event: UniversalAgentEvent): void { this.emit(event.type, event); this.emit('*', event); }
  onEvent(listener: (event: UniversalAgentEvent) => void): this { return this.on('*', listener); }
}
