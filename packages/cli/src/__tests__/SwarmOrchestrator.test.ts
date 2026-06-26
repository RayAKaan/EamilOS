import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SwarmOrchestrator, isErrorResponse } from '../multi-agent/orchestrator/SwarmOrchestrator.js';
import { OpenCodeAgent } from '../multi-agent/agents/OpenCodeAgent.js';
import { GeminiCliAgent } from '../multi-agent/agents/GeminiCliAgent.js';
import { ClaudeCodeAgent } from '../multi-agent/agents/ClaudeCodeAgent.js';
import { AiderAgent } from '../multi-agent/agents/AiderAgent.js';
import { GooseAgent } from '../multi-agent/agents/GooseAgent.js';
import { ConflictArbiter } from '../core/comms/ConflictArbiter.js';

describe('isErrorResponse', () => {
  it('should detect authentication errors', () => {
    expect(isErrorResponse('authentication failed: invalid API key')).toBe(true);
  });

  it('should detect timeout errors', () => {
    expect(isErrorResponse('timed out after 15000ms')).toBe(true);
  });

  it('should detect command not found errors', () => {
    expect(isErrorResponse('command not found: opencode-ai')).toBe(true);
  });

  it('should detect spawn errors', () => {
    expect(isErrorResponse('spawn npx ENOENT')).toBe(true);
  });

  it('should detect JSON error fields', () => {
    expect(isErrorResponse('{"error": "rate limit exceeded"}')).toBe(true);
  });

  it('should pass normal content', () => {
    expect(isErrorResponse('print("hello world")')).toBe(false);
  });

  it('should pass long content (>5000 chars)', () => {
    expect(isErrorResponse('a'.repeat(5001))).toBe(false);
  });

  it('should pass code with error variable names', () => {
    expect(isErrorResponse('const error = new Error("test")')).toBe(false);
  });
});

describe('SwarmOrchestrator', () => {
  let orchestrator: SwarmOrchestrator;

  beforeEach(() => {
    vi.spyOn(OpenCodeAgent.prototype, 'checkInstalled').mockResolvedValue({
      available: true,
      version: '1.0.0',
    });
    vi.spyOn(GeminiCliAgent.prototype, 'checkInstalled').mockResolvedValue({
      available: true,
      version: '1.0.0',
    });
    vi.spyOn(OpenCodeAgent.prototype, 'send').mockResolvedValue({
      id: 'test-oc', timestamp: Date.now(),
      content: '{"files": [{"path": "test.py", "content": "print(\"opencode\")"}]}',
    });
    vi.spyOn(GeminiCliAgent.prototype, 'send').mockResolvedValue({
      id: 'test-gm', timestamp: Date.now(),
      content: '{"files": [{"path": "test.py", "content": "print(\"gemini\")"}]}',
    });
    vi.spyOn(ClaudeCodeAgent.prototype, 'checkInstalled').mockResolvedValue({
      available: true, version: '1.0.0',
    });
    vi.spyOn(AiderAgent.prototype, 'checkInstalled').mockResolvedValue({
      available: true, version: '1.0.0',
    });
    vi.spyOn(GooseAgent.prototype, 'checkInstalled').mockResolvedValue({
      available: true, version: '1.0.0',
    });
    vi.spyOn(ClaudeCodeAgent.prototype, 'send').mockResolvedValue({
      id: 'test-cc', timestamp: Date.now(),
      content: '{"files": [{"path": "test.py", "content": "print(\"claude-code\")"}]}',
    });
    vi.spyOn(AiderAgent.prototype, 'send').mockResolvedValue({
      id: 'test-ad', timestamp: Date.now(),
      content: '{"files": [{"path": "test.py", "content": "print(\"aider\")"}]}',
    });
    vi.spyOn(GooseAgent.prototype, 'send').mockResolvedValue({
      id: 'test-gs', timestamp: Date.now(),
      content: '{"files": [{"path": "test.py", "content": "print(\"goose\")"}]}',
    });
    vi.spyOn(OpenCodeAgent.prototype, 'terminate').mockResolvedValue(undefined);
    vi.spyOn(GeminiCliAgent.prototype, 'terminate').mockResolvedValue(undefined);
    vi.spyOn(ClaudeCodeAgent.prototype, 'terminate').mockResolvedValue(undefined);
    vi.spyOn(AiderAgent.prototype, 'terminate').mockResolvedValue(undefined);
    vi.spyOn(GooseAgent.prototype, 'terminate').mockResolvedValue(undefined);

    orchestrator = new SwarmOrchestrator({
      strategy: 'swarm',
      workingDir: process.cwd(),
      timeoutMs: 5000,
      maxRetries: 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create with correct default config', () => {
    const o = new SwarmOrchestrator({ strategy: 'swarm', workingDir: '/tmp' });
    expect(o).toBeInstanceOf(SwarmOrchestrator);
  });

  it('should perform health check', async () => {
    const health = await orchestrator.healthCheck();
    expect(health.opencode.available).toBe(true);
    expect(health.gemini.available).toBe(true);
    expect(health.graph.nodes).toBeGreaterThanOrEqual(2);
  });

  it('should fall back to keyword analysis when LLM agent fails', async () => {
    vi.spyOn(GeminiCliAgent.prototype, 'send').mockRejectedValue(new Error('Agent unavailable'));
    const analysis = await orchestrator.analyzeTask('Build a REST API with Express');
    expect(analysis.type).toBe('code');
    expect(analysis.requiresCodeGeneration).toBe(true);
    expect(analysis.suggestedStrategy).toBeTruthy();
  });

  it('should classify research tasks correctly', async () => {
    vi.spyOn(GeminiCliAgent.prototype, 'send').mockRejectedValue(new Error('Agent unavailable'));
    const analysis = await orchestrator.analyzeTask('Research and explain quantum computing concepts');
    expect(analysis.type).toBe('research');
    expect(analysis.requiresResearch).toBe(true);
    expect(analysis.suggestedStrategy).toBe('gemini-first');
  });

  it('should classify debug tasks correctly', async () => {
    vi.spyOn(GeminiCliAgent.prototype, 'send').mockRejectedValue(new Error('Agent unavailable'));
    const analysis = await orchestrator.analyzeTask('Fix the bug in the login function');
    expect(analysis.type).toBe('debug');
    expect(analysis.suggestedStrategy).toBe('opencode-first');
  });

  it('should execute swarm strategy and return result', async () => {
    const result = await orchestrator.execute('Test task', 'swarm');
    expect(result.success).toBe(true);
    expect(result.strategy).toBe('swarm');
    expect(result.agentUsed).toContain('swarm');
    expect(result.attempts).toBeGreaterThanOrEqual(1);
  });

  it('should emit arbiter events for conflicting files', async () => {
    // Make claude-code and gemini produce different content for the same file
    vi.spyOn(ClaudeCodeAgent.prototype, 'send').mockResolvedValue({
      id: 'test-cc', timestamp: Date.now(),
      content: '{"files": [{"path": "main.py", "content": "print(1)"}]}',
    });
    vi.spyOn(GeminiCliAgent.prototype, 'send').mockResolvedValue({
      id: 'test-gm', timestamp: Date.now(),
      content: '{"files": [{"path": "main.py", "content": "print(2)"}]}',
    });

    const arbiterSpy = vi.fn();
    orchestrator.on('arbiter', arbiterSpy);

    await orchestrator.execute('Write a Python calculator', 'swarm');

    expect(arbiterSpy).toHaveBeenCalled();
    const event = arbiterSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(event.path).toBe('main.py');
    expect(event.method).toBe('vote');
  });

  it('should emit orchestrator lifecycle events', async () => {
    const startedSpy = vi.fn();
    const completedSpy = vi.fn();
    orchestrator.on('task:started', startedSpy);
    orchestrator.on('task:completed', completedSpy);

    await orchestrator.execute('Test lifecycle', 'swarm');

    expect(startedSpy).toHaveBeenCalledTimes(1);
    expect(completedSpy).toHaveBeenCalledTimes(1);
  });

  it('should track execution in knowledge graph', async () => {
    const result = await orchestrator.execute('Test graph tracking', 'swarm');
    const graph = orchestrator.getGraph();
    const stats = graph.getStats();
    expect(stats.totalNodes).toBeGreaterThanOrEqual(3);
    expect(result.graphNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('should execute with gemini-first strategy', async () => {
    vi.spyOn(GeminiCliAgent.prototype, 'send').mockResolvedValue({
      id: 'test-gm', timestamp: Date.now(),
      content: 'Research plan for building a web app',
    });

    const result = await orchestrator.execute('Build a web app', 'gemini-first');
    expect(result.strategy).toBe('gemini-first');
    expect(result.agentUsed).toContain('gemini');
  });

  it('should execute with opencode-first strategy', async () => {
    const result = await orchestrator.execute('Build a web app', 'opencode-first');
    expect(result.strategy).toBe('opencode-first');
    // The best available coding agent is claude-code (highest priority)
    expect(result.agentUsed).toContain('claude-code');
  });

  it('should validate output and fail on placeholder names', async () => {
    vi.spyOn(ClaudeCodeAgent.prototype, 'send').mockResolvedValue({
      id: 'test-cc', timestamp: Date.now(),
      content: '{"files": [{"path": "data.json", "content": "{}"}]}',
    });
    vi.spyOn(GeminiCliAgent.prototype, 'send').mockResolvedValue({
      id: 'test-gm', timestamp: Date.now(),
      content: '{"files": [{"path": "data.json", "content": "{}"}]}',
    });

    const result = await orchestrator.execute('Build something', 'opencode-first');
    expect(result.validated).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should get graph instance', () => {
    const graph = orchestrator.getGraph();
    expect(graph).toBeDefined();
    expect(typeof graph.getStats).toBe('function');
  });
});

describe('ConflictArbiter integration', () => {
  it('should compute consistent sha256 hashes', () => {
    const hash1 = ConflictArbiter.computeHash('Alpha', 'auth.ts', 'const a = 1;');
    const hash2 = ConflictArbiter.computeHash('Alpha', 'auth.ts', 'const a = 1;');
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });

  it('should compute different hashes for different callsigns or contents', () => {
    const hash1 = ConflictArbiter.computeHash('Alpha', 'auth.ts', 'const a = 1;');
    const hash2 = ConflictArbiter.computeHash('Beta', 'auth.ts', 'const a = 1;');
    expect(hash1).not.toBe(hash2);
  });

  it('should return sole candidate when only one provided', async () => {
    const arbiter = new ConflictArbiter();
    const result = await arbiter.arbitrate([
      { callsign: 'Alpha', path: 'test.ts', hash: 'abc', content: 'const a = 1;' },
    ]);
    expect(result.method).toBe('sole');
    expect(result.winner.callsign).toBe('Alpha');
  });

  it('should return identical when hashes match', async () => {
    const arbiter = new ConflictArbiter();
    const hash = ConflictArbiter.computeHash('Alpha', 'test.ts', 'const a = 1;');
    const result = await arbiter.arbitrate([
      { callsign: 'Alpha', path: 'test.ts', hash, content: 'const a = 1;' },
      { callsign: 'Beta', path: 'test.ts', hash, content: 'const a = 1;' },
    ]);
    expect(result.method).toBe('identical');
  });

  it('should throw on empty candidates', async () => {
    const arbiter = new ConflictArbiter();
    await expect(arbiter.arbitrate([])).rejects.toThrow('No candidates');
  });
});
