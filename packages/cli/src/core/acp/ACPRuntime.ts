import { randomUUID } from 'node:crypto';

export type ACPMessageKind = 'request' | 'response' | 'event' | 'error';

export interface ACPEnvelope<T = unknown> {
  readonly version: '1.0';
  readonly id: string;
  readonly kind: ACPMessageKind;
  readonly sender: string;
  readonly recipient?: string;
  readonly method: string;
  readonly timestamp: number;
  readonly payload: T;
  readonly correlationId?: string;
}

export interface ACPTransport {
  send(message: ACPEnvelope): Promise<void>;
  close?(): Promise<void>;
}

export type ACPHandler = (message: ACPEnvelope) => Promise<unknown> | unknown;

export class ACPRuntime {
  private readonly handlers = new Map<string, ACPHandler>();
  private transport?: ACPTransport;

  attach(transport: ACPTransport): void {
    this.transport = transport;
  }

  register(method: string, handler: ACPHandler): () => void {
    if (this.handlers.has(method)) throw new Error(`ACP method already registered: ${method}`);
    this.handlers.set(method, handler);
    return () => this.handlers.delete(method);
  }

  async request<T>(sender: string, method: string, payload: T, recipient?: string): Promise<string> {
    if (!this.transport) throw new Error('ACP transport is not attached');
    const id = randomUUID();
    await this.transport.send({
      version: '1.0', id, kind: 'request', sender, recipient, method, timestamp: Date.now(), payload,
    });
    return id;
  }

  async handle(message: ACPEnvelope): Promise<ACPEnvelope | undefined> {
    const handler = this.handlers.get(message.method);
    if (!handler) {
      if (message.kind !== 'request') return undefined;
      return {
        version: '1.0', id: randomUUID(), kind: 'error', sender: 'eamilos',
        recipient: message.sender, method: message.method, timestamp: Date.now(),
        payload: { code: 'METHOD_NOT_FOUND' }, correlationId: message.id,
      };
    }
    if (message.kind !== 'request') return undefined;
    try {
      const result = await handler(message);
      return {
        version: '1.0', id: randomUUID(), kind: 'response', sender: 'eamilos',
        recipient: message.sender, method: message.method, timestamp: Date.now(),
        payload: result, correlationId: message.id,
      };
    } catch (error) {
      return {
        version: '1.0', id: randomUUID(), kind: 'error', sender: 'eamilos',
        recipient: message.sender, method: message.method, timestamp: Date.now(),
        payload: { code: 'HANDLER_ERROR', message: error instanceof Error ? error.message : String(error) },
        correlationId: message.id,
      };
    }
  }
}
