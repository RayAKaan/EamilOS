import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SessionManager, initSessionManager, getSessionManager } from '../../src/state/SessionManager.js';

describe('SessionManager', () => {
  let manager: SessionManager;
  let testDir: string;
  let profileId: string;

  beforeEach(async () => {
    profileId = `test-profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    testDir = path.join(os.tmpdir(), `eamilos-test-${profileId}`);
    manager = new SessionManager(profileId);
    await manager.initialize();
  });

  afterEach(async () => {
    manager.stopAutoSave();
    try {
      await fs.rm(path.join(os.homedir(), '.eamilos', 'sessions', profileId), { recursive: true, force: true });
    } catch {
      // Cleanup may fail
    }
  });

  it('saves and loads a session', async () => {
    const messages = [
      { role: 'user' as const, content: 'Hello', timestamp: Date.now() },
      { role: 'assistant' as const, content: 'Hi there', timestamp: Date.now() },
    ];
    manager.setMessages(messages);
    manager.setContext({ activeProjectId: 'proj-1' });

    await manager.save('test-session');
    const session = await manager.load('test-session');

    expect(session).not.toBeNull();
    expect(session?.data.messages).toHaveLength(2);
    expect(session?.data.context.activeProjectId).toBe('proj-1');
  });

  it('restores messages and context', async () => {
    manager.setMessages([{ role: 'user' as const, content: 'test', timestamp: Date.now() }]);
    manager.setContext({ activeProjectId: 'proj-2', agentId: 'agent-1' });
    await manager.save('restore-test');

    const freshManager = new SessionManager(profileId);
    await freshManager.initialize();
    const restored = await freshManager.restore('restore-test');

    expect(restored).toBe(true);
    expect(freshManager.getMessages()).toHaveLength(1);
    expect(freshManager.getContext().activeProjectId).toBe('proj-2');

    freshManager.stopAutoSave();
  });

  it('lists sessions in order of update time', async () => {
    manager.setMessages([{ role: 'user' as const, content: 'a', timestamp: Date.now() }]);
    await manager.save('session-a');

    await new Promise((r) => setTimeout(r, 15));

    manager.setMessages([{ role: 'user' as const, content: 'b', timestamp: Date.now() }]);
    await manager.save('session-b');

    const sessions = await manager.list();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions[0].id).toBe('session-b');
  });

  it('deletes a session', async () => {
    manager.setMessages([{ role: 'user' as const, content: 'del', timestamp: Date.now() }]);
    await manager.save('to-delete');

    const deleted = await manager.delete('to-delete');
    expect(deleted).toBe(true);

    const sessions = await manager.list();
    expect(sessions.find((s) => s.id === 'to-delete')).toBeUndefined();
  });

  it('creates a new session', async () => {
    manager.setMessages([{ role: 'user' as const, content: 'old', timestamp: Date.now() }]);
    const sessionId = await manager.create('my-new-session');

    expect(sessionId).toBe('my-new-session');
    expect(manager.getMessages()).toHaveLength(0);
    expect(manager.getCurrentSession()).toBe('my-new-session');
  });

  it('returns null for non-existent session', async () => {
    const session = await manager.load('does-not-exist');
    expect(session).toBeNull();
  });

  it('sanitizes session names', async () => {
    const sessionId = await manager.create('My Session! @#$%');
    expect(sessionId).toBe('my-session------');
  });

  it('cleans up old sessions', async () => {
    const cleanupProfileId = `cleanup-profile-${Date.now()}`;
    const smallManager = new SessionManager(cleanupProfileId, { maxSessions: 3 });
    await smallManager.initialize();

    for (let i = 0; i < 5; i++) {
      smallManager.setMessages([{ role: 'user' as const, content: `msg-${i}`, timestamp: Date.now() }]);
      await smallManager.save(`session-${i}`);
      await new Promise((r) => setTimeout(r, 10));
    }

    const deleted = await smallManager.cleanup();
    expect(deleted).toBeGreaterThanOrEqual(2);

    const sessions = await smallManager.list();
    expect(sessions.length).toBeLessThanOrEqual(3);

    smallManager.stopAutoSave();
    try {
      await fs.rm(path.join(os.homedir(), '.eamilos', 'sessions', cleanupProfileId), { recursive: true, force: true });
    } catch {
      // Cleanup may fail
    }
  });

  it('saves and loads encrypted session', async () => {
    const encProfileId = `enc-profile-${Date.now()}`;
    const encManager = new SessionManager(encProfileId, { encrypt: true });
    await encManager.initialize();

    encManager.setMessages([{ role: 'user' as const, content: 'secret', timestamp: Date.now() }]);
    await encManager.save('encrypted');

    const session = await encManager.load('encrypted');
    expect(session?.data.messages[0].content).toBe('secret');

    encManager.stopAutoSave();
    try {
      await fs.rm(path.join(os.homedir(), '.eamilos', 'sessions', encProfileId), { recursive: true, force: true });
    } catch {
      // Cleanup may fail
    }
    try {
      const keyPath = path.join(os.homedir(), '.eamilos', '.session-key');
      await fs.unlink(keyPath);
    } catch {
      // Cleanup may fail
    }
  });

  it('auto-saves on interval', async () => {
    manager.setMessages([{ role: 'user' as const, content: 'auto', timestamp: Date.now() }]);
    manager.startAutoSave(500);

    await new Promise((r) => setTimeout(r, 600));

    const session = await manager.load('default');
    expect(session).not.toBeNull();
    expect(session?.data.messages).toHaveLength(1);

    manager.stopAutoSave();
  });

  it('generates health report', async () => {
    manager.setMessages([{ role: 'user' as const, content: 'test', timestamp: Date.now() }]);
    await manager.save('health-test');

    const report = await manager.getHealthReport();
    expect(report.totalSessions).toBeGreaterThanOrEqual(1);
    expect(report.totalSize).toBeGreaterThan(0);
    expect(report.corrupted).toBe(0);
  });

  it('global initSessionManager and getSessionManager work', () => {
    const globalManager = initSessionManager('global-test');
    const retrieved = getSessionManager();
    expect(retrieved).toBe(globalManager);
  });

  it('handles restore of non-existent session gracefully', async () => {
    const result = await manager.restore('ghost-session');
    expect(result).toBe(false);
  });
});
