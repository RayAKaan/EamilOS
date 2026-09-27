import type { CommsMessage, Participant } from './types.js';
import { CommsRegistry } from './CommsRegistry.js';

export class MessageRouter {
  constructor(private readonly registry: CommsRegistry) {}

  recipients(message: CommsMessage): Participant[] {
    if (message.recipientId) {
      const p = this.registry.get(message.recipientId);
      return p ? [p] : [];
    }
    return this.registry.subscriptionsFor(message.topic)
      .map(s => this.registry.get(s.participantId))
      .filter((p): p is Participant => Boolean(p) && p.connected);
  }
}
