import { describe, it, expect } from 'vitest';
import { terminalMessageToAgentResponse, errorToAgentResponse } from '../core/agents/AgentFactory.js';
import type { TerminalMessage } from '../multi-agent/agents/BaseAgent.js';

function makeMsg(overrides: Partial<TerminalMessage> = {}): TerminalMessage {
  return {
    id: 'test-1',
    timestamp: Date.now(),
    content: 'success',
    ...overrides,
  };
}

describe('terminalMessageToAgentResponse', () => {
  it('returns success for clean exitCode 0', () => {
    const msg = makeMsg({ metadata: { exitCode: 0 } });
    const result = terminalMessageToAgentResponse('claude-code', msg, Date.now(), []);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns failure for non-zero exitCode', () => {
    const msg = makeMsg({
      content: 'Claude Code failed: @anthropic-ai/claude-code exited with code 1',
      metadata: { exitCode: 1 },
    });
    const result = terminalMessageToAgentResponse('claude-code', msg, Date.now(), []);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Claude Code failed');
  });

  it('returns failure for textual CLI failure patterns', () => {
    const msg = makeMsg({
      content: 'codex-cli: exit code 1',
      metadata: { exitCode: 0 },
    });
    const result = terminalMessageToAgentResponse('codex-cli', msg, Date.now(), []);
    expect(result.success).toBe(false);
    expect(result.error).toContain('exit code');
  });

  it('returns success for valid response content', () => {
    const msg = makeMsg({
      content: '{"summary": "done", "files": []}',
      metadata: { exitCode: 0 },
    });
    const result = terminalMessageToAgentResponse('opencode', msg, Date.now(), []);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.content).toBe('{"summary": "done", "files": []}');
  });

  it('passes fileChanges through on success', () => {
    const msg = makeMsg({ metadata: { exitCode: 0 } });
    const changes = [{ path: 'test.ts', action: 'modify' as const, content: 'new', sourceAgentId: 'opencode' }];
    const result = terminalMessageToAgentResponse('opencode', msg, Date.now(), changes);
    expect(result.success).toBe(true);
    expect(result.fileChanges).toEqual(changes);
  });

  it('returns empty fileChanges on failure', () => {
    const msg = makeMsg({
      content: 'Aider failed: exit code 1',
      metadata: { exitCode: 1 },
    });
    const result = terminalMessageToAgentResponse('aider', msg, Date.now(), [{ path: 'x.ts', action: 'create', content: '', sourceAgentId: 'aider' }]);
    expect(result.success).toBe(false);
    expect(result.fileChanges).toEqual([]);
  });
});

describe('errorToAgentResponse', () => {
  it('returns failure for an Error object', () => {
    const result = errorToAgentResponse('gemini-cli', new Error('Connection refused'), Date.now());
    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection refused');
  });

  it('returns failure for a string error', () => {
    const result = errorToAgentResponse('goose', 'something crashed', Date.now());
    expect(result.success).toBe(false);
    expect(result.error).toBe('something crashed');
  });
});
