import type { AgentRequest, AgentResponse, AgentKind, AgentCapabilities, RegisteredAgent } from './types.js';

export type { AgentRequest, AgentResponse, AgentKind, AgentCapabilities, RegisteredAgent };

export interface EamilOSAgent {
  id: string;
  name: string;
  kind: AgentKind;
  capabilities: AgentCapabilities;

  checkStatus(): Promise<RegisteredAgent>;
  run(request: AgentRequest): Promise<AgentResponse>;
  stop?(): Promise<void>;
}
