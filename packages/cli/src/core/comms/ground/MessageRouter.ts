import type { CommsMessage, Participant } from './types.js';
import { CommsRegistry } from './CommsRegistry.js';

function topicMatches(subscription: string, topic: string): boolean {
  if (subscription === '*' || subscription === topic) return true;
  if (subscription.endsWith('*')) return topic.startsWith(subscription.slice(0, -1));
  return false;
}

export class MessageRouter {
  constructor(private readonly registry: CommsRegistry) {}

  recipients(message: CommsMessage): Participant[] {
    if (message.recipientId) {
      const p = this.registry.get(message.recipientId);
      return p ? [p] : [];
    }
    const ids = new Set(this.registry.subscriptionsFor(message.topic).map(s => s.participantId));
    return [...ids]
      .map(id => this.registry.get(id))
      .filter((p): p is Participant => Boolean(p) && p.connected)
      .filter(p => [...this.registry.snapshot().subscriptions].some(s => s.participantId === p.id && topicMatches(s.topic, message.topic)));
  }
}
