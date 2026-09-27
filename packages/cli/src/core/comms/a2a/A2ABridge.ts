import { randomUUID } from 'node:crypto';
import type { CommsGround } from '../ground/CommsGround.js';
import type { A2AAgentCard, A2AMessage, A2ATask } from './types.js';

export class A2ABridge {
  constructor(private readonly ground: CommsGround) {}
  async publishTask(senderId: string, recipientId: string, task: A2ATask): Promise<void> {
    await this.ground.publish({ conversationId: task.contextId, correlationId: task.id, senderId, senderRole: 'service', recipientId, topic: 'a2a.task', kind: 'TASK', delivery: 'AT_LEAST_ONCE', payload: task });
  }
  fromA2AMessage(message: A2AMessage) { return { conversationId: randomUUID(), messageId: message.messageId, payload: message.parts }; }
  toAgentCard(participant: { name: string; endpoint?: string; capabilities: string[] }): A2AAgentCard {
    return { name: participant.name, description: 'EamilOS A2A participant', version: '1.0.0', url: participant.endpoint, capabilities: { streaming: true, pushNotifications: true }, skills: participant.capabilities.map(id => ({ id, name: id, description: id })) };
  }
}