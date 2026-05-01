import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridge, createBridge } from '../../src/bridge.js';

describe('UIBridge Integration', () => {
  let bridge: UIBridge;

  beforeEach(() => {
    bridge = createBridge({ mockMode: true });
  });

  afterEach(async () => {
    await bridge.shutdown();
  });

  it('initializes in mock mode', async () => {
    await bridge.initialize();
    const state = bridge.getState();
    expect(state).toBeDefined();
    expect(state.messages).toEqual([]);
  });

  it('handles user messages', async () => {
    await bridge.initialize();

    const messages: any[] = [];
    bridge.on('message:add', (msg: any) => messages.push(msg));

    await bridge.sendMessage('echo "test"');

    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('echo "test"');
  });

  it('handles slash commands', async () => {
    await bridge.initialize();

    const helpResult = await bridge.executeSlashCommand('/help');
    expect(helpResult).toContain('EamilOS Slash Commands');

    const agentsResult = await bridge.executeSlashCommand('/agents');
    expect(agentsResult).toContain('mock-agent');
  });

  it('emits typing events', async () => {
    await bridge.initialize();

    const typingEvents: any[] = [];
    bridge.on('agent:typing', (data: any) => typingEvents.push(data));

    await bridge.sendMessage('test');

    expect(typingEvents.length).toBe(2);
    expect(typingEvents[0].active).toBe(true);
    expect(typingEvents[1].active).toBe(false);
  });

  it('tracks messages in state', async () => {
    await bridge.initialize();

    await bridge.sendMessage('message 1');
    await bridge.sendMessage('message 2');

    const state = bridge.getState();
    expect(state.messages.length).toBeGreaterThanOrEqual(4);
  });

  it('handles session reset', async () => {
    await bridge.initialize();

    await bridge.sendMessage('test');
    const result = await bridge.executeSlashCommand('/new');

    expect(result).toContain('New session');
    expect(bridge.getState().messages.length).toBe(1);
  });

  it('handles cost report in mock mode', async () => {
    await bridge.initialize();

    const report = bridge.getCostReport();
    expect(report).toContain('mock mode');
  });

  it('handles parallel execution', async () => {
    await bridge.initialize();

    const result = await bridge.executeParallel('test task');
    expect(result).toContain('agent');
  });

  it('handles delegation', async () => {
    await bridge.initialize();

    const result = await bridge.delegate('mock-agent', 'test task');
    expect(result).toContain('Delegated');
  });

  it('handles context compression', async () => {
    await bridge.initialize();

    const result = await bridge.executeSlashCommand('/compact');
    expect(result).toContain('within limits');
  });
});

describe('UIBridge Task Classification', () => {
  let bridge: UIBridge;

  beforeEach(() => {
    bridge = createBridge({ mockMode: true });
  });

  afterEach(async () => {
    await bridge.shutdown();
  });

  it('classifies coding tasks', async () => {
    await bridge.initialize();
    const result = await bridge.sendMessage('build an API');
    expect(result).toBeDefined();
  });

  it('classifies qa tasks', async () => {
    await bridge.initialize();
    const result = await bridge.sendMessage('test the auth module');
    expect(result).toBeDefined();
  });

  it('classifies research tasks', async () => {
    await bridge.initialize();
    const result = await bridge.sendMessage('investigate performance issues');
    expect(result).toBeDefined();
  });
});
