import type { DecisionContext, JevProvider, JevProviderResponse } from '../types.js';

export interface JevTransport {
  request(context: DecisionContext): Promise<JevProviderResponse>;
  health?(): Promise<{ healthy: boolean; error?: string }>;
}

export class JevProviderAdapter implements JevProvider {
  readonly id: string;
  constructor(id: string, private readonly transport: JevTransport) { this.id = id; }
  decide(context: DecisionContext): Promise<JevProviderResponse> {
    return this.transport.request(context);
  }
  async health(): Promise<{ healthy: boolean; error?: string }> {
    return this.transport.health ? this.transport.health() : { healthy: true };
  }
}
