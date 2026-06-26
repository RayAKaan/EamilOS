import { EventEmitter } from 'events';

export type Permission = 'file:read' | 'file:write' | 'file:delete' | 'command:execute' | 'network:access';

export type PermissionDecision = 'allow-once' | 'allow-session' | 'deny' | 'deny-session';

export interface PermissionRequest {
  id: string;
  sessionId: string;
  agentId: string;
  toolName: string;
  action: 'read' | 'write' | 'delete' | 'command' | 'network';
  path?: string;
  command?: string;
  diff?: string;
  reason: string;
  timestamp: number;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  requireApproval?: boolean;
  request?: PermissionRequest;
}

export class PermissionService extends EventEmitter {
  private defaultPolicy: PermissionDecision;
  private sessionPermissions: Map<string, Set<string>> = new Map();
  private pendingRequests: Map<string, PermissionRequest> = new Map();

  constructor(defaultPolicy: PermissionDecision = 'deny') {
    super();
    this.defaultPolicy = defaultPolicy;
  }

  checkFileWrite(sessionId: string, agentId: string, path: string, toolName: string): PermissionCheckResult {
    return this.evaluate(sessionId, agentId, { action: 'write', path, toolName, reason: `Write to ${path}` });
  }

  checkFileRead(sessionId: string, agentId: string, path: string, toolName: string): PermissionCheckResult {
    return { allowed: true, reason: 'Read allowed' };
  }

  checkFileDelete(sessionId: string, agentId: string, path: string, toolName: string): PermissionCheckResult {
    return this.evaluate(sessionId, agentId, { action: 'delete', path, toolName, reason: `Delete ${path}` });
  }

  checkCommandExecute(sessionId: string, agentId: string, command: string, toolName: string): PermissionCheckResult {
    return this.evaluate(sessionId, agentId, { action: 'command', command, toolName, reason: `Run: ${command.slice(0, 80)}` });
  }

  checkNetworkAccess(sessionId: string, agentId: string, host: string, toolName: string): PermissionCheckResult {
    return this.evaluate(sessionId, agentId, { action: 'network', path: host, toolName, reason: `Access ${host}` });
  }

  resolveRequest(requestId: string, decision: PermissionDecision): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) return;
    this.pendingRequests.delete(requestId);

    if (decision === 'allow-session') {
      const key = `${request.sessionId}:${request.action}`;
      const perms = this.sessionPermissions.get(request.sessionId) ?? new Set();
      perms.add(key);
      this.sessionPermissions.set(request.sessionId, perms);
    }

    this.emit('permission:resolved', { requestId, decision, request });
  }

  private evaluate(sessionId: string, agentId: string, partial: Partial<PermissionRequest>): PermissionCheckResult {
    const key = `${sessionId}:${partial.action}`;
    if (this.sessionPermissions.get(sessionId)?.has(key)) {
      return { allowed: true, reason: 'Approved for session' };
    }

    if (this.defaultPolicy === 'deny') {
      if (partial.action === 'read') {
        return { allowed: true, reason: 'Read allowed' };
      }
      const request: PermissionRequest = {
        id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sessionId,
        agentId,
        toolName: partial.toolName ?? 'unknown',
        action: (partial.action ?? 'write') as PermissionRequest['action'],
        path: partial.path,
        command: partial.command,
        reason: partial.reason ?? 'No reason given',
        timestamp: Date.now(),
      };
      this.pendingRequests.set(request.id, request);
      this.emit('permission:requested', request);
      return { allowed: false, requireApproval: true, request, reason: 'Pending approval' };
    }

    return { allowed: true, reason: `Policy: ${this.defaultPolicy}` };
  }

  getPendingRequests(): PermissionRequest[] {
    return Array.from(this.pendingRequests.values());
  }

  clearSession(sessionId: string): void {
    this.sessionPermissions.delete(sessionId);
    for (const [id, req] of this.pendingRequests) {
      if (req.sessionId === sessionId) this.pendingRequests.delete(id);
    }
  }
}

let globalPermissionService: PermissionService | null = null;

export function getPermissionService(): PermissionService {
  if (!globalPermissionService) {
    globalPermissionService = new PermissionService('deny');
  }
  return globalPermissionService;
}

export function initPermissionService(policy?: PermissionDecision): PermissionService {
  globalPermissionService = new PermissionService(policy ?? 'deny');
  return globalPermissionService;
}
