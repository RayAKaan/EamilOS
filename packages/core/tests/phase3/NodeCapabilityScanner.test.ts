import { describe, it, expect } from 'vitest';
import { NodeCapabilityScanner } from '../../src/distributed/NodeCapabilityScanner.js';

describe('NodeCapabilityScanner', () => {
  describe('scan', () => {
    it('should return node capabilities with CPU info', async () => {
      const capabilities = await NodeCapabilityScanner.scan();

      expect(capabilities.cpuCores).toBeGreaterThan(0);
      expect(capabilities.totalRAMBytes).toBeGreaterThan(0);
      expect(capabilities.availableRAMBytes).toBeGreaterThan(0);
    });

    it('should return platform info', async () => {
      const capabilities = await NodeCapabilityScanner.scan();

      expect(typeof capabilities.platform).toBe('string');
      expect(['linux', 'darwin', 'win32']).toContain(capabilities.platform);
      expect(typeof capabilities.arch).toBe('string');
    });

    it('should return empty GPU array by default', async () => {
      const capabilities = await NodeCapabilityScanner.scan();

      expect(Array.isArray(capabilities.gpus)).toBe(true);
    });

    it('should return empty providers array when no getter provided', async () => {
      const capabilities = await NodeCapabilityScanner.scan();

      expect(Array.isArray(capabilities.providers)).toBe(true);
    });

    it('should return empty models array when no getter provided', async () => {
      const capabilities = await NodeCapabilityScanner.scan();

      expect(Array.isArray(capabilities.models)).toBe(true);
    });

    it('should calculate max concurrent tasks based on available RAM', async () => {
      const capabilities = await NodeCapabilityScanner.scan();

      expect(capabilities.maxConcurrentTasks).toBeGreaterThan(0);
      expect(capabilities.maxConcurrentTasks).toBeLessThanOrEqual(8);
    });

    it('should initialize currentLoad to 0', async () => {
      const capabilities = await NodeCapabilityScanner.scan();

      expect(capabilities.currentLoad).toBe(0);
    });

    it('should use provider status getter when provided', async () => {
      const mockStatuses = [
        {
          id: 'test-provider',
          type: 'local',
          engine: 'test',
          available: true,
          models: [{ name: 'test-model' }],
        },
      ];

      const capabilities = await NodeCapabilityScanner.scan(
        () => mockStatuses,
        () => ({ contextWindow: 4096, tags: ['test'] })
      );

      expect(capabilities.providers).toHaveLength(1);
      expect(capabilities.providers[0].id).toBe('test-provider');
    });

    it('should use model metadata getter when provided', async () => {
      const mockStatuses = [
        {
          id: 'test-provider',
          type: 'local',
          engine: 'test',
          available: true,
          models: [{ name: 'test-model' }],
        },
      ];

      const mockMetadata = { contextWindow: 8192, tags: ['code', 'fast'] };

      const capabilities = await NodeCapabilityScanner.scan(
        () => mockStatuses,
        () => mockMetadata
      );

      expect(capabilities.models).toHaveLength(1);
      expect(capabilities.models[0].maxContextLength).toBe(8192);
      expect(capabilities.models[0].tags).toEqual(['code', 'fast']);
    });
  });

  describe('capabilities structure', () => {
    it('should have all required fields', async () => {
      const capabilities = await NodeCapabilityScanner.scan();

      expect(capabilities).toHaveProperty('cpuCores');
      expect(capabilities).toHaveProperty('totalRAMBytes');
      expect(capabilities).toHaveProperty('availableRAMBytes');
      expect(capabilities).toHaveProperty('gpus');
      expect(capabilities).toHaveProperty('providers');
      expect(capabilities).toHaveProperty('models');
      expect(capabilities).toHaveProperty('maxConcurrentTasks');
      expect(capabilities).toHaveProperty('currentLoad');
      expect(capabilities).toHaveProperty('platform');
      expect(capabilities).toHaveProperty('arch');
    });

    it('should have RAM values in bytes', async () => {
      const capabilities = await NodeCapabilityScanner.scan();

      expect(capabilities.totalRAMBytes).toBeGreaterThan(1024 * 1024 * 1024);
      expect(capabilities.availableRAMBytes).toBeLessThanOrEqual(capabilities.totalRAMBytes);
    });
  });
});
