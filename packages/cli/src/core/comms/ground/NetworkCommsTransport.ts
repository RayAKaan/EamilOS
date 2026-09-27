import type { CommsMessage, CommsTransport } from './types.js';
import type { NetworkManager } from '../../distributed/NetworkManager.js';

export class NetworkCommsTransport implements CommsTransport {
  readonly id: string;
  constructor(id: string, private readonly network: NetworkManager) { this.id = id; }

  async send(message: CommsMessage): Promise<void> {
    const connection = this.network.getWorkerConnection(this.id);
    if (!connection) throw new Error(`Worker not connected: ${this.id}`);
    this.network.sendMessage(connection.socket, 'comms:publish', message, this.id);
  }

  async health() {
    const connected = Boolean(this.network.getWorkerConnection(this.id));
    return connected ? { healthy: true } : { healthy: false, error: 'worker not connected' };
  }
}
