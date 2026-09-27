import { randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { CommsRegistry } from './CommsRegistry.js';
import { MessageRouter } from './MessageRouter.js';
import { MessageStore } from './MessageStore.js';
import { CommsMessageSchema, type CommsEvent, type CommsMessage, type CommsTransport, type DeliveryReceipt, type Participant, type Subscription } from './types.js';

const PROTOCOL_VERSION = 1;
const MAX_AGE_MS = 60_000;
const MAX_FUTURE_MS = 10_000;

export class CommsGround {
  private readonly registry = new CommsRegistry();
  private readonly router = new MessageRouter(this.registry);
  private readonly store: MessageStore;
  private readonly transports = new Map<string, CommsTransport>();
  private readonly events: CommsEvent[] = [];
  private readonly processed = new Set<string>();

  constructor(options?: { store?: MessageStore; sharedKey?: string }) {
    this.store = options?.store ?? new MessageStore();
    this.sharedKey = options?.sharedKey;
  }
  private readonly sharedKey?: string;

  registerParticipant(participant: Participant, transport?: CommsTransport): Participant {
    const value = this.registry.register(participant);
    if (transport) this.transports.set(participant.id, transport);
    this.emit({ type: 'participant.registered', participantId: participant.id });
    return value;
  }

  unregisterParticipant(id: string) {
    this.transports.delete(id);
    this.registry.unregister(id);
    this.emit({ type: 'participant.disconnected', participantId: id });
  }

  subscribe(participantId: string, topic: string): Subscription {
    if (!this.registry.get(participantId)) throw new Error(`Unknown participant: ${participantId}`);
    const sub = { id: randomUUID(), participantId, topic, createdAt: Date.now() };
    this.registry.subscribe(sub);
    this.emit({ type: 'subscription.created', participantId, data: { topic } });
    return sub;
  }

  unsubscribe(id: string) { return this.registry.unsubscribe(id); }

  async publish(input: Omit<CommsMessage, 'protocolVersion'|'messageId'|'timestamp'|'signature'>): Promise<CommsMessage> {
    const message: CommsMessage = {
      ...input,
      protocolVersion: PROTOCOL_VERSION,
      messageId: randomUUID(),
      timestamp: Date.now(),
      signature: this.sharedKey ? this.sign(input) : undefined,
    };
    const parsed = CommsMessageSchema.safeParse(message);
    if (!parsed.success) throw new Error(parsed.error.message);
    this.validateEnvelope(message);
    await this.store.save(message);

    const recipients = this.router.recipients(message);
    if (message.recipientId && recipients.length === 0) throw new Error(`Recipient not connected: ${message.recipientId}`);
    for (const recipient of recipients) await this.deliver(message, recipient.id);
    this.emit({ type: 'message.published', messageId: message.messageId, participantId: message.senderId });
    return message;
  }

  async receive(message: unknown, recipientId: string): Promise<DeliveryReceipt> {
    const parsed = CommsMessageSchema.parse(message);
    this.validateEnvelope(parsed);
    if (parsed.signature && this.sharedKey && !this.verify(parsed)) throw new Error('Invalid comms signature');
    const duplicate = this.processed.has(`${parsed.messageId}:${recipientId}`);
    if (duplicate) {
      const receipt = { messageId: parsed.messageId, recipientId, deliveredAt: Date.now(), duplicate: true };
      this.emit({ type: 'message.duplicate', messageId: parsed.messageId, participantId: recipientId });
      return receipt;
    }
    this.processed.add(`${parsed.messageId}:${recipientId}`);
    await this.store.save(parsed);
    const receipt = { messageId: parsed.messageId, recipientId, deliveredAt: Date.now(), duplicate: false };
    await this.store.saveReceipt(receipt);
    return receipt;
  }

  async publishArtifact(senderId: string, artifact: unknown, topic = 'artifact.published') {
    return this.broadcast(senderId, topic, 'ARTIFACT', artifact);
  }

  async publishMemory(senderId: string, memory: unknown, topic = 'memory.published') {
    return this.broadcast(senderId, topic, 'MEMORY', memory);
  }

  async broadcast(senderId: string, topic: string, kind: CommsMessage['kind'], payload: unknown, metadata: Record<string, unknown> = {}) {
    return this.publish({
      conversationId: randomUUID(),
      senderId,
      senderRole: this.registry.get(senderId)?.role ?? 'service',
      topic, kind, delivery: 'AT_LEAST_ONCE', payload, metadata,
    });
  }

  private async deliver(message: CommsMessage, recipientId: string) {
    const transport = this.transports.get(recipientId);
    if (!transport) return;
    if (message.delivery !== 'AT_MOST_ONCE' && await this.store.hasReceipt(message.messageId, recipientId)) return;
    await transport.send(message);
    const receipt: DeliveryReceipt = { messageId: message.messageId, recipientId, deliveredAt: Date.now(), duplicate: false };
    await this.store.saveReceipt(receipt);
    this.processed.add(`${message.messageId}:${recipientId}`);
    this.emit({ type: 'message.delivered', messageId: message.messageId, participantId: recipientId });
  }

  private validateEnvelope(message: CommsMessage) {
    if (message.protocolVersion !== PROTOCOL_VERSION) throw new Error('Unsupported comms protocol version');
    const age = Date.now() - message.timestamp;
    if (age > MAX_AGE_MS || age < -MAX_FUTURE_MS) throw new Error('Expired or future comms message');
  }

  private sign(input: Omit<CommsMessage, 'signature'>): string {
    return createHmac('sha256', this.sharedKey!).update(JSON.stringify(input)).digest('hex');
  }

  private verify(message: CommsMessage): boolean {
    if (!message.signature) return false;
    const copy = { ...message };
    delete copy.signature;
    const expected = createHmac('sha256', this.sharedKey!).update(JSON.stringify(copy)).digest('hex');
    const a = Buffer.from(expected, 'hex'); const b = Buffer.from(message.signature, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private emit(event: CommsEvent) {
    this.events.push({ ...event, timestamp: Date.now() });
    if (this.events.length > 500) this.events.shift();
  }

  snapshot() { return { ...this.registry.snapshot(), recentEvents: [...this.events], receipts: [] }; }
}
