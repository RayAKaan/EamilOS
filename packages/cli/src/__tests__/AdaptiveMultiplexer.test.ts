import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdaptiveMultiplexer, type AgentTerminalDef } from '../terminal/AdaptiveMultiplexer.js';

describe('AdaptiveMultiplexer', () => {
  let multiplexer: AdaptiveMultiplexer;

  beforeEach(() => {
    vi.restoreAllMocks();
    multiplexer = new AdaptiveMultiplexer();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('detects single environment when CI is set', () => {
    vi.stubEnv('CI', 'true');
    expect(AdaptiveMultiplexer.detectEnvironment()).toBe('single');
  });

  it('detects windows terminal', () => {
    vi.stubEnv('WT_SESSION', 'some-session');
    vi.stubEnv('CI', '');
    expect(AdaptiveMultiplexer.detectEnvironment()).toBe('windows-terminal');
  });

  it('detects tmux', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-1234/default');
    vi.stubEnv('CI', '');
    expect(AdaptiveMultiplexer.detectEnvironment()).toBe('tmux');
  });

  it('detects vscode', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('CI', '');
    expect(AdaptiveMultiplexer.detectEnvironment()).toBe('vscode');
  });

  it('defaults to single when no env matches', () => {
    vi.stubEnv('CI', '');
    vi.stubEnv('WT_SESSION', '');
    vi.stubEnv('TMUX', '');
    vi.stubEnv('TERM_PROGRAM', '');
    expect(AdaptiveMultiplexer.detectEnvironment()).toBe('single');
  });

  it('isMultiplexingSupported returns false in single env', () => {
    vi.stubEnv('CI', 'true');
    expect(AdaptiveMultiplexer.isMultiplexingSupported()).toBe(false);
  });

  it('isMultiplexingSupported returns true in tmux', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-1234/default');
    vi.stubEnv('CI', '');
    expect(AdaptiveMultiplexer.isMultiplexingSupported()).toBe(true);
  });

  it('returns empty terminals list initially', () => {
    expect(multiplexer.getActiveTerminals()).toEqual([]);
  });

  it('spawnAgentTerminals returns terminals for each agent', async () => {
    vi.stubEnv('CI', 'true');
    const agents: AgentTerminalDef[] = [
      { id: 'opencode', callsign: 'Alpha', command: 'opencode', args: ['--version'] },
    ];
    const terminals = await multiplexer.spawnAgentTerminals(agents);
    expect(terminals).toHaveLength(1);
    expect(terminals[0].agentId).toBe('opencode');
    expect(terminals[0].callsign).toBe('Alpha');
  });

  it('spawnAgentTerminals returns empty for empty input', async () => {
    vi.stubEnv('CI', 'true');
    const terminals = await multiplexer.spawnAgentTerminals([]);
    expect(terminals).toEqual([]);
  });

  it('emits terminals-spawned event', async () => {
    vi.stubEnv('CI', 'true');
    const handler = vi.fn();
    multiplexer.on('multiplexer:terminals-spawned', handler);
    await multiplexer.spawnAgentTerminals([
      { id: 'opencode', callsign: 'Alpha', command: 'opencode', args: [] },
    ]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
  });

  it('terminateAll clears all terminals', async () => {
    vi.stubEnv('CI', 'true');
    await multiplexer.spawnAgentTerminals([
      { id: 'opencode', callsign: 'Alpha', command: 'opencode', args: [] },
    ]);
    multiplexer.terminateAll();
    expect(multiplexer.getActiveTerminals()).toEqual([]);
  });

  it('switchMode updates terminal mode', async () => {
    vi.stubEnv('CI', 'true');
    await multiplexer.spawnAgentTerminals([
      { id: 'opencode', callsign: 'Alpha', command: 'opencode', args: [], mode: 'communication' },
    ]);
    multiplexer.switchMode('Alpha', 'execution');
    expect(multiplexer.getMode('Alpha')).toBe('execution');
  });

  it('getTerminal returns undefined for unknown callsign', () => {
    expect(multiplexer.getTerminal('Unknown')).toBeUndefined();
  });

  it('does not execute shell commands from agent args in spawn', async () => {
    vi.stubEnv('CI', 'true');
    const malicious: AgentTerminalDef[] = [
      { id: 'test', callsign: 'T1', command: 'echo', args: ['$(rm -rf /)'] },
    ];
    const terminals = await multiplexer.spawnAgentTerminals(malicious);
    expect(terminals).toHaveLength(1);
    expect(terminals[0].callsign).toBe('T1');
  });
});
