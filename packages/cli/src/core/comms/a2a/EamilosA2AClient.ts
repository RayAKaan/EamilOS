import { A2AEnvelopeSchema, AgentCardSchema, type AgentCard, type EamilosA2AMessage, type TaskRequest } from './EamilosA2AProtocol.js';

export interface EamilosA2AClientOptions {
  token?: string;
  timeoutMs?: number;
}

export class EamilosA2AClient {
  constructor(private readonly options: EamilosA2AClientOptions = {}) {}

  async discover(endpoint: string): Promise<AgentCard> {
    const response = await this.request(endpoint, '/.well-known/agent-card.json', { method: 'GET' });
    return AgentCardSchema.parse(await response.json());
  }

  async send(endpoint: string, request: TaskRequest): Promise<EamilosA2AMessage> {
    const response = await this.request(endpoint, '/eamilos/a2a/tasks', {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'content-type': 'application/json' },
    });
    return A2AEnvelopeSchema.parse(await response.json());
  }

  async cancel(endpoint: string, request: TaskRequest, reason?: string): Promise<EamilosA2AMessage> {
    const response = await this.request(endpoint, `/eamilos/a2a/tasks/${encodeURIComponent(request.executionId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ ...request, reason }),
      headers: { 'content-type': 'application/json' },
    });
    return A2AEnvelopeSchema.parse(await response.json());
  }

  async heartbeat(endpoint: string): Promise<EamilosA2AMessage> {
    const response = await this.request(endpoint, '/eamilos/a2a/heartbeat', { method: 'GET' });
    return A2AEnvelopeSchema.parse(await response.json());
  }

  private async request(endpoint: string, path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    try {
      const headers = new Headers(init.headers);
      if (this.options.token) headers.set('authorization', `Bearer ${this.options.token}`);
      headers.set('accept', 'application/json');
      const response = await fetch(new URL(path, endpoint), { ...init, headers, signal: controller.signal });
      if (!response.ok) throw new Error(`EamilOS A2A request failed: ${response.status}`);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}
