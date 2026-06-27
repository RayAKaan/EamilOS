import { describe, it, expect, beforeEach } from 'vitest';
import { PermissionService, getPermissionService, initPermissionService } from '../core/permissions.js';

describe('PermissionService', () => {
  let service: PermissionService;

  beforeEach(() => {
    service = new PermissionService('deny');
  });

  it('allows reads by default', () => {
    const result = service.checkFileRead('s1', 'agent-a', '/tmp/test.txt', 'file:read');
    expect(result.allowed).toBe(true);
  });

  it('denies writes by default and creates a permission request', () => {
    const result = service.checkFileWrite('s1', 'agent-a', '/tmp/test.txt', 'file:write');
    expect(result.allowed).toBe(false);
    expect(result.requireApproval).toBe(true);
    expect(result.request).toBeDefined();
    expect(result.request!.action).toBe('write');
    expect(result.request!.agentId).toBe('agent-a');
  });

  it('denies deletes by default', () => {
    const result = service.checkFileDelete('s1', 'agent-a', '/tmp/test.txt', 'file:delete');
    expect(result.allowed).toBe(false);
    expect(result.requireApproval).toBe(true);
  });

  it('denies command execution by default', () => {
    const result = service.checkCommandExecute('s1', 'agent-a', 'rm -rf /', 'command:execute');
    expect(result.allowed).toBe(false);
    expect(result.requireApproval).toBe(true);
  });

  it('stores pending requests', () => {
    service.checkFileWrite('s1', 'agent-a', '/tmp/a.txt', 'file:write');
    service.checkFileWrite('s1', 'agent-b', '/tmp/b.txt', 'file:write');
    expect(service.getPendingRequests()).toHaveLength(2);
  });

  it('resolves a request with allow-once and removes it from pending', () => {
    service.checkFileWrite('s1', 'agent-a', '/tmp/test.txt', 'file:write');
    const pending = service.getPendingRequests();
    expect(pending).toHaveLength(1);

    service.resolveRequest(pending[0].id, 'allow-once');
    expect(service.getPendingRequests()).toHaveLength(0);
  });

  it('allow-session permits subsequent same-action writes', () => {
    const r1 = service.checkFileWrite('s1', 'agent-a', '/tmp/a.txt', 'file:write');
    expect(r1.allowed).toBe(false);

    service.resolveRequest(r1.request!.id, 'allow-session');

    const r2 = service.checkFileWrite('s1', 'agent-a', '/tmp/b.txt', 'file:write');
    expect(r2.allowed).toBe(true);
    expect(r2.reason).toContain('Approved for session');
  });

  it('clears session state', () => {
    service.checkFileWrite('s1', 'agent-a', '/tmp/a.txt', 'file:write');
    service.clearSession('s1');
    expect(service.getPendingRequests()).toHaveLength(0);

    const r = service.checkFileWrite('s1', 'agent-a', '/tmp/b.txt', 'file:write');
    expect(r.allowed).toBe(false);
  });

  it('emits permission:requested event', () => {
    const events: unknown[] = [];
    service.on('permission:requested', (req) => events.push(req));

    service.checkFileWrite('s1', 'agent-a', '/tmp/test.txt', 'file:write');
    expect(events).toHaveLength(1);
    expect((events[0] as any).agentId).toBe('agent-a');
  });

  it('emits permission:resolved event', () => {
    const events: unknown[] = [];
    service.on('permission:resolved', (ev) => events.push(ev));

    service.checkFileWrite('s1', 'agent-a', '/tmp/test.txt', 'file:write');
    const pending = service.getPendingRequests();
    service.resolveRequest(pending[0].id, 'allow-once');

    expect(events).toHaveLength(1);
    expect((events[0] as any).decision).toBe('allow-once');
  });

  it('getPermissionService returns singleton', () => {
    const svc1 = getPermissionService();
    const svc2 = getPermissionService();
    expect(svc1).toBe(svc2);
  });

  it('initPermissionService creates new singleton', () => {
    const svc1 = initPermissionService('deny');
    const svc2 = getPermissionService();
    expect(svc1).toBe(svc2);
  });

  it('waitForDecision respects timeoutMs option', async () => {
    const result = service.checkFileWrite('s1', 'agent-a', '/tmp/test.txt', 'file:write');
    expect(result.request).toBeDefined();

    const start = Date.now();
    const decisionPromise = service.waitForDecision(result.request!, {
      timeoutMs: 50,
      defaultDecision: 'deny',
    });

    const decision = await decisionPromise;
    expect(decision).toBe('deny');
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });

  it('waitForDecision respects defaultDecision option', async () => {
    const result = service.checkFileWrite('s2', 'agent-b', '/tmp/test.txt', 'file:write');
    expect(result.request).toBeDefined();

    const start = Date.now();
    const decision = await service.waitForDecision(result.request!, {
      timeoutMs: 20,
      defaultDecision: 'deny',
    });
    expect(decision).toBe('deny');
  });

  it('waitForDecision with defaultDecision allow-once on timeout', async () => {
    const result = service.checkFileWrite('s3', 'agent-c', '/tmp/test.txt', 'file:write');
    expect(result.request).toBeDefined();

    const decision = await service.waitForDecision(result.request!, {
      timeoutMs: 20,
      defaultDecision: 'allow-once',
    });
    expect(decision).toBe('allow-once');
  });
});
