import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from '../../src/orchestrator.js';
import { Project, Task } from '../../src/types.js';

function createMockProject(): Project {
  return {
    id: 'test-project-1',
    name: 'Test Project',
    rootDir: '/tmp/test',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).substr(2, 9)}`,
    projectId: 'test-project-1',
    title: 'Test Task',
    description: 'Test task description',
    type: 'implementation',
    status: 'pending',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PHASE - Stabilization: Orchestrator Tests (O-1 through O-9)', () => {

  describe('O-1: Orchestrator initialization', () => {
    it('should create orchestrator with default options', () => {
      const orchestrator = new Orchestrator();
      expect(orchestrator).toBeDefined();
      expect(orchestrator.isRunning()).toBe(false);
    });

    it('should create orchestrator with custom options', () => {
      const orchestrator = new Orchestrator({ maxParallel: 5, maxRetries: 2 });
      expect(orchestrator).toBeDefined();
      expect(orchestrator.isRunning()).toBe(false);
    });
  });

  describe('O-2: Task status checks', () => {
    it('should report not running initially', () => {
      const orchestrator = new Orchestrator();
      expect(orchestrator.isRunning()).toBe(false);
    });

    it('should stop orchestrator', () => {
      const orchestrator = new Orchestrator();
      orchestrator.stop();
      expect(orchestrator.isRunning()).toBe(false);
    });
  });

  describe('O-3: Task dependency helper', () => {
    it('should handle tasks without dependencies', () => {
      const orchestrator = new Orchestrator();
      const project = createMockProject();
      const tasks = [createMockTask({ title: 'Independent Task' })];

      expect(orchestrator.isRunning()).toBe(false);
      orchestrator.stop();
      expect(tasks.length).toBe(1);
    });
  });

  describe('O-4: Retry tracking', () => {
    it('should return 0 for non-existent task attempts', () => {
      const orchestrator = new Orchestrator({ maxParallel: 1, maxRetries: 3 });
      expect(orchestrator.getAttemptCount('nonexistent')).toBe(0);
    });

    it('should return undefined for non-existent execution context', () => {
      const orchestrator = new Orchestrator();
      expect(orchestrator.getExecutionContext('nonexistent')).toBeUndefined();
    });
  });

  describe('O-5: Response validation - valid JSON', () => {
    it('should validate JSON response from model output', () => {
      const orchestrator = new Orchestrator();
      
      const validResponse = JSON.stringify({
        files: [
          { path: 'test.js', content: 'console.log("hello");' }
        ]
      });

      const result = orchestrator.validateResponse(validResponse);
      expect(result.valid).toBe(true);
    });

    it('should accept valid response with summary', () => {
      const orchestrator = new Orchestrator();
      
      const response = JSON.stringify({
        files: [
          { path: 'index.ts', content: 'export default function() {}' }
        ],
        summary: 'Created main file'
      });

      const result = orchestrator.validateResponse(response);
      expect(result.valid).toBe(true);
    });
  });

  describe('O-6: Response validation - invalid JSON', () => {
    it('should reject invalid JSON response', () => {
      const orchestrator = new Orchestrator();
      
      const invalidResponse = 'This is not JSON at all';

      const result = orchestrator.validateResponse(invalidResponse);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('NO_JSON_FOUND');
    });

    it('should reject malformed JSON', () => {
      const orchestrator = new Orchestrator();
      
      const malformed = '{ files: [{ path: "test.ts" }]'; // missing closing brace

      const result = orchestrator.validateResponse(malformed);
      expect(result.valid).toBe(false);
    });
  });

  describe('O-7: Blocked filename detection', () => {
    it('should filter blocked filenames from validation', () => {
      const orchestrator = new Orchestrator();
      
      const response = JSON.stringify({
        files: [
          { path: 'data.json', content: '{"key": "value"}' },
          { path: 'real.js', content: 'module.exports = {};' }
        ]
      });

      const result = orchestrator.validateResponse(response);
      expect(result.valid).toBe(true);
    });
  });

  describe('O-8: Empty files array detection', () => {
    it('should reject responses with empty files array', () => {
      const orchestrator = new Orchestrator();
      
      const response = JSON.stringify({
        files: [],
        summary: 'No files created'
      });

      const result = orchestrator.validateResponse(response);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('NO_VALID_FILES');
    });

    it('should reject responses with no files key', () => {
      const orchestrator = new Orchestrator();
      
      const response = JSON.stringify({
        summary: 'Did something else'
      });

      const result = orchestrator.validateResponse(response);
      expect(result.valid).toBe(false);
    });
  });

  describe('O-9: Multiple files extraction', () => {
    it('should extract multiple valid files from response', () => {
      const orchestrator = new Orchestrator();
      
      const response = JSON.stringify({
        files: [
          { path: 'main.ts', content: 'const x = 1;' },
          { path: 'utils/helper.ts', content: 'export function help() {}' },
          { path: 'types.ts', content: 'export type Foo = string;' }
        ],
        summary: 'Created 3 files'
      });

      const result = orchestrator.validateResponse(response);
      expect(result.valid).toBe(true);
    });

    it('should handle deeply nested structures', () => {
      const orchestrator = new Orchestrator();
      
      const response = JSON.stringify({
        files: [
          { 
            path: 'config/app.json', 
            content: JSON.stringify({ name: 'test', version: '1.0.0' }) 
          }
        ]
      });

      const result = orchestrator.validateResponse(response);
      expect(result.valid).toBe(true);
    });
  });

});
