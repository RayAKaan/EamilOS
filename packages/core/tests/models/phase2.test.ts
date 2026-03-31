import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ModelProfile, ExecutionStrategy, PreflightTestResult } from '../../src/models/types.js';
import { ModelRegistry, getModelRegistry, initModelRegistry, TOOL_SYSTEM_PROMPT, STRICT_JSON_SYSTEM_PROMPT, NUCLEAR_JSON_SYSTEM_PROMPT } from '../../src/models/ModelRegistry.js';
import { TaskSplitter } from '../../src/models/TaskSplitter.js';
import { SecureLogger } from '../../src/security/SecureLogger.js';
import { SecretManager } from '../../src/security/SecretManager.js';

describe('Phase 2: Model Abstraction', () => {
  let mockLogger: SecureLogger;
  let mockSecretManager: SecretManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;
    mockSecretManager = {
      get: vi.fn(),
    } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('P2-T1: Type Definitions', () => {
    it('should export ModelProfile interface with required fields', () => {
      const profile: ModelProfile = {
        name: 'gpt-4',
        provider: 'openai',
        supportsTools: true,
        supportsJSON: true,
        supportsStreaming: true,
        maxContextTokens: 8192,
        maxOutputTokens: 4096,
        reliabilityScore: 0.95,
        jsonComplianceRate: 0.9,
        avgResponseTimeMs: 1500,
        testedAt: new Date().toISOString(),
        testResults: [],
      };

      expect(profile.name).toBe('gpt-4');
      expect(profile.provider).toBe('openai');
      expect(profile.reliabilityScore).toBe(0.95);
    });

    it('should export ExecutionStrategy interface with correct modes', () => {
      const strategy: ExecutionStrategy = {
        mode: 'tool',
        promptStrictness: 'normal',
        maxRetries: 3,
        retryDelayMs: 0,
        requiresTaskSplitting: false,
        maxTaskSizeChars: 50000,
        systemPrompt: TOOL_SYSTEM_PROMPT,
      };

      expect(strategy.mode).toBe('tool');
      expect(['tool', 'json_strict', 'json_nuclear'].includes(strategy.mode)).toBe(true);
    });

    it('should export PreflightTestResult interface', () => {
      const result: PreflightTestResult = {
        testName: 'JSON Compliance',
        passed: true,
        responseTimeMs: 500,
        details: 'Perfect JSON match',
      };

      expect(result.testName).toBe('JSON Compliance');
      expect(result.passed).toBe(true);
    });
  });

  describe('P2-T2: PreflightTester Module Export', () => {
    it('should export TaskSplitter class', () => {
      const splitter = new TaskSplitter();
      expect(splitter).toBeDefined();
    });
  });

  describe('P2-T3: ModelRegistry Instantiation', () => {
    it('should create ModelRegistry instance', () => {
      const registry = new ModelRegistry(mockLogger);
      expect(registry).toBeDefined();
    });

    it('should initialize global registry', () => {
      const registry = initModelRegistry(mockLogger);
      expect(registry).toBeDefined();
      expect(getModelRegistry()).toBe(registry);
    });

    it('should throw if getModelRegistry called before init', async () => {
      vi.resetModules();
      const { getModelRegistry: getRegistry2 } = await import('../../src/models/ModelRegistry.js');
      expect(() => getRegistry2()).toThrow('ModelRegistry not initialized');
    });
  });

  describe('P2-T4: ModelRegistry Execution Strategy', () => {
    it('should return tool mode for high reliability with tools', () => {
      const registry = new ModelRegistry(mockLogger);
      const profile: ModelProfile = {
        name: 'gpt-4',
        provider: 'openai',
        supportsTools: true,
        supportsJSON: true,
        supportsStreaming: true,
        maxContextTokens: 8192,
        maxOutputTokens: 4096,
        reliabilityScore: 0.9,
        jsonComplianceRate: 0.9,
        avgResponseTimeMs: 1000,
        testedAt: new Date().toISOString(),
        testResults: [],
      };

      const strategy = registry.getExecutionStrategy(profile);
      
      expect(strategy.mode).toBe('tool');
      expect(strategy.promptStrictness).toBe('normal');
      expect(strategy.maxRetries).toBe(3);
    });

    it('should return json_strict for medium reliability', () => {
      const registry = new ModelRegistry(mockLogger);
      const profile: ModelProfile = {
        name: 'gpt-3.5-turbo',
        provider: 'openai',
        supportsTools: false,
        supportsJSON: true,
        supportsStreaming: true,
        maxContextTokens: 4096,
        maxOutputTokens: 2048,
        reliabilityScore: 0.6,
        jsonComplianceRate: 0.7,
        avgResponseTimeMs: 800,
        testedAt: new Date().toISOString(),
        testResults: [],
      };

      const strategy = registry.getExecutionStrategy(profile);
      
      expect(strategy.mode).toBe('json_strict');
      expect(strategy.promptStrictness).toBe('strict');
      expect(strategy.maxRetries).toBe(4);
    });

    it('should return json_nuclear for low reliability', () => {
      const registry = new ModelRegistry(mockLogger);
      const profile: ModelProfile = {
        name: 'llama2',
        provider: 'ollama',
        supportsTools: false,
        supportsJSON: false,
        supportsStreaming: false,
        maxContextTokens: 2048,
        maxOutputTokens: 1024,
        reliabilityScore: 0.3,
        jsonComplianceRate: 0.2,
        avgResponseTimeMs: 2000,
        testedAt: new Date().toISOString(),
        testResults: [],
      };

      const strategy = registry.getExecutionStrategy(profile);
      
      expect(strategy.mode).toBe('json_nuclear');
      expect(strategy.promptStrictness).toBe('nuclear');
      expect(strategy.maxRetries).toBe(5);
      expect(strategy.requiresTaskSplitting).toBe(true);
    });
  });

  describe('P2-T5: System Prompts', () => {
    it('should export tool system prompt', () => {
      expect(TOOL_SYSTEM_PROMPT).toContain('code generation assistant');
      expect(TOOL_SYSTEM_PROMPT).toContain('tool-calling');
    });

    it('should export strict JSON system prompt', () => {
      expect(STRICT_JSON_SYSTEM_PROMPT).toContain('valid JSON');
      expect(STRICT_JSON_SYSTEM_PROMPT).toContain('files');
      expect(STRICT_JSON_SYSTEM_PROMPT).toContain('machine-parsed');
    });

    it('should export nuclear JSON system prompt', () => {
      expect(NUCLEAR_JSON_SYSTEM_PROMPT).toContain('JSON ONLY');
      expect(NUCLEAR_JSON_SYSTEM_PROMPT).toContain('JSON.parse()');
    });
  });

  describe('P2-T6: TaskSplitter Detection', () => {
    it('should not split when not required', () => {
      const splitter = new TaskSplitter();
      const strategy: ExecutionStrategy = {
        mode: 'tool',
        promptStrictness: 'normal',
        maxRetries: 3,
        retryDelayMs: 0,
        requiresTaskSplitting: false,
        maxTaskSizeChars: 50000,
        systemPrompt: '',
      };

      expect(splitter.shouldSplit('Simple instruction', strategy)).toBe(false);
    });

    it('should detect large instructions', () => {
      const splitter = new TaskSplitter();
      const strategy: ExecutionStrategy = {
        mode: 'json_nuclear',
        promptStrictness: 'nuclear',
        maxRetries: 5,
        retryDelayMs: 1000,
        requiresTaskSplitting: true,
        maxTaskSizeChars: 100,
        systemPrompt: '',
      };

      const largeInstruction = 'x'.repeat(200);
      expect(splitter.shouldSplit(largeInstruction, strategy)).toBe(true);
    });

    it('should detect multiple file extensions', () => {
      const splitter = new TaskSplitter();
      const strategy: ExecutionStrategy = {
        mode: 'json_nuclear',
        promptStrictness: 'nuclear',
        maxRetries: 5,
        retryDelayMs: 1000,
        requiresTaskSplitting: true,
        maxTaskSizeChars: 50000,
        systemPrompt: '',
      };

      const instruction = 'Create index.html and style.css';
      expect(splitter.shouldSplit(instruction, strategy)).toBe(true);
    });

    it('should detect enumerated items', () => {
      const splitter = new TaskSplitter();
      const strategy: ExecutionStrategy = {
        mode: 'json_nuclear',
        promptStrictness: 'nuclear',
        maxRetries: 5,
        retryDelayMs: 1000,
        requiresTaskSplitting: true,
        maxTaskSizeChars: 50000,
        systemPrompt: '',
      };

      const instruction = '1. First task\n2. Second task\n3. Third task';
      expect(splitter.shouldSplit(instruction, strategy)).toBe(true);
    });
  });

  describe('P2-T7: TaskSplitter Splitting', () => {
    it('should split enumerated items', () => {
      const splitter = new TaskSplitter();
      const instruction = '1. Create hello.py\n2. Create world.js';

      const parts = splitter.split(instruction);
      
      expect(parts.length).toBe(2);
      expect(parts[0]).toContain('hello.py');
      expect(parts[1]).toContain('world.js');
    });

    it('should limit split to 5 items', () => {
      const splitter = new TaskSplitter();
      const instruction = '1. A\n2. B\n3. C\n4. D\n5. E\n6. F\n7. G\n8. H';

      const parts = splitter.split(instruction);
      
      expect(parts.length).toBe(5);
    });

    it('should return original instruction if no split needed', () => {
      const splitter = new TaskSplitter();
      const instruction = 'Create a simple file';

      const parts = splitter.split(instruction);
      
      expect(parts.length).toBe(1);
      expect(parts[0]).toBe(instruction);
    });
  });

  describe('P2-T8: TaskSplitter Reassembly', () => {
    it('should reassemble successful results', () => {
      const splitter = new TaskSplitter();
      const results = [
        {
          success: true,
          files: [{ path: 'a.txt', content: 'content a' }],
          summary: 'Part A',
          rawResponse: '{}',
        },
        {
          success: true,
          files: [{ path: 'b.txt', content: 'content b' }],
          summary: 'Part B',
          rawResponse: '{}',
        },
      ];

      const reassembled = splitter.reassemble(results);
      
      expect(reassembled.success).toBe(true);
      expect(reassembled.files.length).toBe(2);
      expect(reassembled.summary).toBe('Part A | Part B');
    });

    it('should deduplicate files with same path', () => {
      const splitter = new TaskSplitter();
      const results = [
        {
          success: true,
          files: [{ path: 'config.json', content: 'v1' }],
          summary: 'Version 1',
          rawResponse: '{}',
        },
        {
          success: true,
          files: [{ path: 'config.json', content: 'v2' }],
          summary: 'Version 2',
          rawResponse: '{}',
        },
      ];

      const reassembled = splitter.reassemble(results);
      
      expect(reassembled.files.length).toBe(1);
      expect(reassembled.files[0].content).toBe('v2');
    });

    it('should return failure if no files', () => {
      const splitter = new TaskSplitter();
      const results = [
        { success: false, files: [], rawResponse: '{}' },
      ];

      const reassembled = splitter.reassemble(results);
      
      expect(reassembled.success).toBe(false);
      expect(reassembled.files.length).toBe(0);
    });
  });
});
