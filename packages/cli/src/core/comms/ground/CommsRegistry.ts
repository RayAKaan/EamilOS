import type { Participant, Subscription } from './types.js';

export class CommsRegistry {
  private participants = new Map<string, Participant>();
  private subscriptions = new Map<string, Subscription>();

  register(participant: Participant): Participant {
    const existing = this.participants.get(participant.id);
    const value = { ...existing, ...participant };
    this.participants.set(participant.id, value);
    return value;
  }

  unregister(id: string): boolean { return this.participants.delete(id); }
  get(id: string): Participant | undefined { return this.participants.get(id); }
  list(): Participant[] { return [...this.participants.values()]; }

  subscribe(subscription: Subscription): Subscription {
    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  unsubscribe(id: string): boolean { return this.subscriptions.delete(id); }
  subscriptionsFor(topic: string): Subscription[] {
    return [...this.subscriptions.values()].filter(s => s.topic === topic || s.topic === '*' || (s.topic.endsWith('*') && topic.startsWith(s.topic.slice(0, -1))));
  }
  snapshot() { return { participants: this.list(), subscriptions: [...this.subscriptions.values()] }; }
}
