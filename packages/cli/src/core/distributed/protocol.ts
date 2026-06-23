import { createHmac, timingSafeEqual } from 'crypto';
import zlib from 'zlib';
import type { NetworkMessage, NetworkValidationResult } from './types.js';

const DEFAULT_COMPRESSION_THRESHOLD = 1024;

export function compress(data: string): Buffer {
  return zlib.gzipSync(data);
}

export function decompress(buffer: Buffer): string {
  return zlib.gunzipSync(buffer).toString();
}

export function shouldCompress(
  messageType: string | undefined,
  dataLength: number,
  threshold?: number
): boolean {
  if (messageType === 'task:stream') {
    return false;
  }
  return dataLength > (threshold || DEFAULT_COMPRESSION_THRESHOLD);
}

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_AGE_MS = 30000;
const MAX_FUTURE_DRIFT_MS = 5000;

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function generateChallenge(): string {
  return createHmac('sha256', Date.now().toString())
    .update(Math.random().toString(32))
    .digest('hex');
}

export function createHMAC(algorithm: string, key: string, data: string): string {
  return createHmac(algorithm, key).update(data).digest('hex');
}

export function signMessage(message: Omit<NetworkMessage, 'signature'>, sharedKey: string): string {
  const payload = JSON.stringify({
    messageId: message.messageId,
    timestamp: message.timestamp,
    type: message.type,
    from: message.from,
    to: message.to,
    payload: message.payload,
  });
  return createHMAC('sha256', sharedKey, payload);
}

export function verifyMessage(message: NetworkMessage, sharedKey: string): boolean {
  if (!message.signature) {
    return false;
  }

  const expectedSignature = signMessage(message, sharedKey);
  try {
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const actualBuffer = Buffer.from(message.signature, 'hex');

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, actualBuffer);
  } catch {
    return false;
  }
}

export function validateMessage(message: NetworkMessage): NetworkValidationResult {
  const issues: string[] = [];

  if (message.protocolVersion !== PROTOCOL_VERSION) {
    issues.push(`Unsupported protocol version: ${message.protocolVersion}`);
  }

  const age = Date.now() - message.timestamp;
  if (age > MAX_MESSAGE_AGE_MS) {
    issues.push(`Message too old: ${age}ms (max: ${MAX_MESSAGE_AGE_MS}ms)`);
  }
  if (age < -MAX_FUTURE_DRIFT_MS) {
    issues.push(`Message from the future: ${-age}ms ahead`);
  }

  if (!message.messageId) {
    issues.push('Missing messageId');
  }
  if (!message.type) {
    issues.push('Missing type');
  }
  if (!message.from) {
    issues.push('Missing from');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function createNetworkMessage(
  type: NetworkMessage['type'],
  from: string,
  to: string,
  payload: unknown
): Omit<NetworkMessage, 'signature'> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    messageId: generateUUID(),
    timestamp: Date.now(),
    type,
    from,
    to,
    payload,
  };
}

export interface SerializedMessage {
  data: string;
  compressed: boolean;
}

export function serializeMessage(
  message: Omit<NetworkMessage, 'signature'>,
  sharedKey?: string,
  enableCompression?: boolean
): SerializedMessage {
  const msg: NetworkMessage = {
    ...message,
    signature: sharedKey ? signMessage(message, sharedKey) : undefined,
  };
  const jsonStr = JSON.stringify(msg);

  if (enableCompression && shouldCompress(message.type, jsonStr.length)) {
    return {
      data: compress(jsonStr).toString('base64'),
      compressed: true,
    };
  }

  return {
    data: jsonStr,
    compressed: false,
  };
}

export function serializeMessageToString(
  message: Omit<NetworkMessage, 'signature'>,
  sharedKey?: string,
  compressionEnabled?: boolean
): string {
  const serialized = serializeMessage(message, sharedKey, compressionEnabled);
  return JSON.stringify(serialized);
}

export function parseMessage(data: string): NetworkMessage | null {
  try {
    const parsed = JSON.parse(data);

    if ('compressed' in parsed && parsed.compressed) {
      const decompressed = decompress(Buffer.from(parsed.data, 'base64'));
      return JSON.parse(decompressed) as NetworkMessage;
    }

    if ('type' in parsed && 'protocolVersion' in parsed) {
      return parsed as NetworkMessage;
    }

    if ('data' in parsed && 'compressed' in parsed) {
      const content = parsed.compressed
        ? decompress(Buffer.from(parsed.data, 'base64'))
        : parsed.data;
      return JSON.parse(content) as NetworkMessage;
    }

    return parsed as NetworkMessage;
  } catch {
    return null;
  }
}
