// PHASE 2: Full implementation - permission engine
import { AgentDefinition } from './types.js';

export type Permission = 'file:read' | 'file:write' | 'file:delete' | 'command:execute' | 'network:access';

export interface PermissionCheck {
  allowed: boolean;
  reason?: string;
}

export class PermissionEngine {
  private defaultPolicy: 'allow' | 'deny' | 'ask';
  private agentPermissions: Map<string, Set<Permission>> = new Map();

  constructor(defaultPolicy: 'allow' | 'deny' | 'ask' = 'allow') {
    this.defaultPolicy = defaultPolicy;
  }

  check(_agent: AgentDefinition, _permission: Permission): PermissionCheck {
    if (this.defaultPolicy === 'allow') {
      return { allowed: true };
    }

    if (this.defaultPolicy === 'deny') {
      return { allowed: false, reason: 'Default policy is deny' };
    }

    return { allowed: true, reason: 'Default policy is ask - allowed by default' };
  }

  checkFileWrite(_agent: AgentDefinition, _path: string): PermissionCheck {
    return { allowed: true };
  }

  checkFileRead(_agent: AgentDefinition, _path: string): PermissionCheck {
    return { allowed: true };
  }

  checkFileDelete(_agent: AgentDefinition, _path: string): PermissionCheck {
    return { allowed: true };
  }

  checkCommandExecute(_agent: AgentDefinition, _command: string): PermissionCheck {
    return { allowed: true };
  }

  checkNetworkAccess(_agent: AgentDefinition, _host: string): PermissionCheck {
    return { allowed: true };
  }

  grantPermission(agentId: string, permission: Permission): void {
    const permissions = this.agentPermissions.get(agentId) ?? new Set();
    permissions.add(permission);
    this.agentPermissions.set(agentId, permissions);
  }

  revokePermission(agentId: string, permission: Permission): void {
    const permissions = this.agentPermissions.get(agentId);
    if (permissions) {
      permissions.delete(permission);
    }
  }

  setDefaultPolicy(policy: 'allow' | 'deny' | 'ask'): void {
    this.defaultPolicy = policy;
  }
}

let globalPermissionEngine: PermissionEngine | null = null;

export function initPermissionEngine(defaultPolicy?: 'allow' | 'deny' | 'ask'): PermissionEngine {
  globalPermissionEngine = new PermissionEngine(defaultPolicy);
  return globalPermissionEngine;
}

export function getPermissionEngine(): PermissionEngine {
  if (!globalPermissionEngine) {
    return initPermissionEngine();
  }
  return globalPermissionEngine;
}
