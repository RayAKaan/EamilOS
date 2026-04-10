import { describe, it, expect } from 'vitest';
import {
  generateUUID,
  generateChallenge,
  createHMAC,
  signMessage,
  verifyMessage,
  validateMessage,
  serializeMessageToString,
  parseMessage,
  compress,
  decompress,
  shouldCompress,
} from '../../src/distributed/protocol.js';
import type { NetworkMessage } from '../../src/distributed/types.js';

describe('Protocol Utilities', () => {
  describe('generateUUID', () => {
    it('should generate a valid UUID format', () => {
      const uuid = generateUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        uuids.add(generateUUID());
      }
      expect(uuids.size).toBe(100);
    });
  });

  describe('generateChallenge', () => {
    it('should generate a hex-encoded challenge', () => {
      const challenge = generateChallenge();
      expect(challenge).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should generate unique challenges', () => {
      const challenges = new Set<string>();
      for (let i = 0; i < 10; i++) {
        challenges.add(generateChallenge());
      }
      expect(challenges.size).toBe(10);
    });
  });

  describe('createHMAC', () => {
    it('should create a hex-encoded HMAC', () => {
      const hmac = createHMAC('sha256', 'secret', 'data');
      expect(hmac).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce consistent results for same input', () => {
      const hmac1 = createHMAC('sha256', 'secret', 'data');
      const hmac2 = createHMAC('sha256', 'secret', 'data');
      expect(hmac1).toBe(hmac2);
    });

    it('should produce different results for different inputs', () => {
      const hmac1 = createHMAC('sha256', 'secret', 'data1');
      const hmac2 = createHMAC('sha256', 'secret', 'data2');
      expect(hmac1).not.toBe(hmac2);
    });

    it('should produce different results for different secrets', () => {
      const hmac1 = createHMAC('sha256', 'secret1', 'data');
      const hmac2 = createHMAC('sha256', 'secret2', 'data');
      expect(hmac1).not.toBe(hmac2);
    });
  });

  describe('signMessage', () => {
    it('should sign a message correctly', () => {
      const message = {
        protocolVersion: 1,
        messageId: 'test-id',
        timestamp: Date.now(),
        type: 'heartbeat:ping' as const,
        from: 'node1',
        to: 'node2',
        payload: { data: 'test' },
      };

      const signature = signMessage(message, 'secret');
      expect(signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce different signatures for different messages', () => {
      const msg1 = {
        protocolVersion: 1,
        messageId: 'id1',
        timestamp: Date.now(),
        type: 'heartbeat:ping' as const,
        from: 'node1',
        to: 'node2',
        payload: {},
      };

      const msg2 = {
        protocolVersion: 1,
        messageId: 'id2',
        timestamp: Date.now(),
        type: 'heartbeat:ping' as const,
        from: 'node1',
        to: 'node2',
        payload: {},
      };

      const sig1 = signMessage(msg1, 'secret');
      const sig2 = signMessage(msg2, 'secret');
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifyMessage', () => {
    it('should verify a correctly signed message', () => {
      const message: Omit<NetworkMessage, 'signature'> = {
        protocolVersion: 1,
        messageId: 'test-id',
        timestamp: Date.now(),
        type: 'heartbeat:ping',
        from: 'node1',
        to: 'node2',
        payload: {},
      };

      const signature = signMessage(message, 'secret');
      const fullMessage: NetworkMessage = {
        ...message,
        signature,
      };

      expect(verifyMessage(fullMessage, 'secret')).toBe(true);
    });

    it('should reject a message without signature', () => {
      const message: NetworkMessage = {
        protocolVersion: 1,
        messageId: 'test-id',
        timestamp: Date.now(),
        type: 'heartbeat:ping',
        from: 'node1',
        to: 'node2',
        payload: {},
      };

      expect(verifyMessage(message, 'secret')).toBe(false);
    });

    it('should reject a message with wrong signature', () => {
      const message: NetworkMessage = {
        protocolVersion: 1,
        messageId: 'test-id',
        timestamp: Date.now(),
        type: 'heartbeat:ping',
        from: 'node1',
        to: 'node2',
        payload: {},
        signature: 'invalid-signature',
      };

      expect(verifyMessage(message, 'secret')).toBe(false);
    });
  });

  describe('validateMessage', () => {
    it('should validate a correct message', () => {
      const message: NetworkMessage = {
        protocolVersion: 1,
        messageId: 'test-id',
        timestamp: Date.now(),
        type: 'heartbeat:ping',
        from: 'node1',
        to: 'node2',
        payload: {},
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should reject message with wrong protocol version', () => {
      const message: NetworkMessage = {
        protocolVersion: 99,
        messageId: 'test-id',
        timestamp: Date.now(),
        type: 'heartbeat:ping',
        from: 'node1',
        to: 'node2',
        payload: {},
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Unsupported protocol version: 99');
    });

    it('should reject message missing messageId', () => {
      const message: NetworkMessage = {
        protocolVersion: 1,
        messageId: '',
        timestamp: Date.now(),
        type: 'heartbeat:ping',
        from: 'node1',
        to: 'node2',
        payload: {},
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing messageId');
    });

    it('should reject message missing type', () => {
      const message: NetworkMessage = {
        protocolVersion: 1,
        messageId: 'test-id',
        timestamp: Date.now(),
        type: '' as NetworkMessage['type'],
        from: 'node1',
        to: 'node2',
        payload: {},
      };

      const result = validateMessage(message);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing type');
    });
  });

  describe('serializeMessage and parseMessage', () => {
    it('should serialize and parse a message correctly', () => {
      const message: Omit<NetworkMessage, 'signature'> = {
        protocolVersion: 1,
        messageId: 'test-id',
        timestamp: Date.now(),
        type: 'task:result',
        from: 'node1',
        to: 'node2',
        payload: { result: 'success' },
      };

      const serialized = serializeMessageToString(message);
      const parsed = parseMessage(serialized);

      expect(parsed).not.toBeNull();
      expect(parsed?.messageId).toBe('test-id');
      expect(parsed?.type).toBe('task:result');
      expect(parsed?.payload).toEqual({ result: 'success' });
    });

    it('should include signature when sharedKey provided', () => {
      const message: Omit<NetworkMessage, 'signature'> = {
        protocolVersion: 1,
        messageId: 'test-id',
        timestamp: Date.now(),
        type: 'heartbeat:ping',
        from: 'node1',
        to: 'node2',
        payload: {},
      };

      const serialized = serializeMessageToString(message, 'secret');
      const parsed = parseMessage(serialized);

      expect(parsed?.signature).toBeDefined();
      expect(parsed?.signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should return null for invalid JSON', () => {
      const parsed = parseMessage('not valid json');
      expect(parsed).toBeNull();
    });
  });

  describe('Compression', () => {
    it('should compress large messages', () => {
      const largePayload = 'x'.repeat(2000);
      expect(shouldCompress('task:result', largePayload.length)).toBe(true);
    });

    it('should not compress small messages', () => {
      const smallPayload = 'hello';
      expect(shouldCompress('task:result', smallPayload.length)).toBe(false);
    });

    it('should not compress stream messages', () => {
      expect(shouldCompress('task:stream', 2000)).toBe(false);
    });

    it('should compress and decompress correctly', () => {
      const original = 'Hello, this is a test message for compression!';
      const compressed = compress(original);
      const decompressed = decompress(compressed);
      expect(decompressed).toBe(original);
    });

    it('should serialize and parse compressed messages', () => {
      const message: Omit<NetworkMessage, 'signature'> = {
        protocolVersion: 1,
        messageId: 'test-id',
        timestamp: Date.now(),
        type: 'task:result',
        from: 'node1',
        to: 'node2',
        payload: { data: 'x'.repeat(2000) },
      };

      const serialized = serializeMessageToString(message, undefined, true);
      const parsed = parseMessage(serialized);

      expect(parsed).not.toBeNull();
      expect((parsed?.payload as { data: string }).data).toBe('x'.repeat(2000));
    });
  });
});
