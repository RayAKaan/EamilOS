import type { CommsMessage, CommsTransport } from './types.js';
export class InMemoryTransport implements CommsTransport {
  readonly id: string;
  readonly received: CommsMessage[] = [];
  constructor(id: string, private readonly onReceive?: (message: CommsMessage) => Promise<void>|void) { this.id = id; }
  async send(message: CommsMessage) { this.received.push(message); await this.onReceive?.(message); }
}
