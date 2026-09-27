import { createHash, randomUUID, sign, verify } from 'crypto';
import type { FabricMessage, FabricMessageType } from './types.js';
const MAX_MESSAGE_AGE_MS = 30000;
const MAX_FUTURE_DRIFT_MS = 5000;
function canonicalPayload(message: Omit<FabricMessage, 'signature'>): string {
  return JSON.stringify({ protocolVersion: message.protocolVersion, messageId: message.messageId, timestamp: message.timestamp, type: message.type, from: message.from, to: message.to, payload: message.payload });
}
export function createFabricMessage<T>(type: FabricMessageType, from: string, privateKey: string, payload: T, to?: string): FabricMessage<T> {
  const unsigned: Omit<FabricMessage<T>, 'signature'> = { protocolVersion: 1, messageId: randomUUID(), timestamp: Date.now(), type, from, to, payload };
  return { ...unsigned, signature: sign(null, Buffer.from(canonicalPayload(unsigned)), privateKey).toString('base64') };
}
export function verifyFabricMessage(message: FabricMessage, publicKey: string): boolean {
  try { return verify(null, Buffer.from(canonicalPayload(message)), publicKey, Buffer.from(message.signature, 'base64')); } catch { return false; }
}
export function validateFabricMessage(message: FabricMessage): string[] {
  const issues: string[] = [];
  if (message.protocolVersion !== 1) issues.push('Unsupported protocol version: ' + message.protocolVersion);
  if (!message.messageId) issues.push('Missing messageId'); if (!message.from) issues.push('Missing sender'); if (!message.type) issues.push('Missing message type'); if (!message.signature) issues.push('Missing signature');
  const age = Date.now() - message.timestamp; if (age > MAX_MESSAGE_AGE_MS) issues.push('Message too old: ' + age + 'ms'); if (age < -MAX_FUTURE_DRIFT_MS) issues.push('Message timestamp is too far in the future: ' + (-age) + 'ms');
  return issues;
}
export function fingerprintPublicKey(publicKey: string): string { return createHash('sha256').update(publicKey).digest('hex').slice(0, 32); }
