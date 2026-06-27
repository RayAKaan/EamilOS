import { describe, it, expect } from 'vitest';
import { PermissionService } from '../core/permissions.js';

describe('PermissionService async approval', () => {
  it('resolves async approval requests', async () => {
    const service = new PermissionService('deny');

    const request = {
      id: 'perm_test',
      sessionId: 's1',
      agentId: 'opencode',
      toolName: 'file:write',
      action: 'write' as const,
      path: 'src/a.ts',
      reason: 'Write file',
      timestamp: Date.now(),
    };

    const promise = service.requestApproval(request);
    service.resolveRequest('perm_test', 'allow-once');

    await expect(promise).resolves.toBe('allow-once');
  });

  it('resolves with allow-session', async () => {
    const service = new PermissionService('deny');

    const request = {
      id: 'perm_test_2',
      sessionId: 's2',
      agentId: 'gemini',
      toolName: 'file:write',
      action: 'write' as const,
      path: 'src/b.ts',
      reason: 'Write file',
      timestamp: Date.now(),
    };

    const promise = service.requestApproval(request);
    service.resolveRequest('perm_test_2', 'allow-session');

    await expect(promise).resolves.toBe('allow-session');
  });

  it('resolves with deny', async () => {
    const service = new PermissionService('deny');

    const request = {
      id: 'perm_test_3',
      sessionId: 's3',
      agentId: 'aider',
      toolName: 'file:delete',
      action: 'delete' as const,
      path: 'src/c.ts',
      reason: 'Delete file',
      timestamp: Date.now(),
    };

    const promise = service.requestApproval(request);
    service.resolveRequest('perm_test_3', 'deny');

    await expect(promise).resolves.toBe('deny');
  });

  it('emits permission:resolved event', async () => {
    const service = new PermissionService('deny');
    const events: unknown[] = [];

    service.on('permission:resolved', (data) => {
      events.push(data);
    });

    const request = {
      id: 'perm_test_4',
      sessionId: 's4',
      agentId: 'opencode',
      toolName: 'file:write',
      action: 'write' as const,
      path: 'src/d.ts',
      reason: 'Write file',
      timestamp: Date.now(),
    };

    const promise = service.requestApproval(request);
    service.resolveRequest('perm_test_4', 'allow-once');

    await promise;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ requestId: 'perm_test_4', decision: 'allow-once' });
  });
});
