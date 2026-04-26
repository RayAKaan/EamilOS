import * as path from 'path';
import { EventEmitter } from 'events';

export interface SecurityPolicy {
  allowedCommands: string[];
  blockedPatterns: string[];
  maxFileSizeMB: number;
  sandboxEnabled: boolean;
}

interface AuditEntry {
  timestamp: number;
  action: string;
  agentId: string;
  details: Record<string, unknown>;
}

export class SecurityManager extends EventEmitter {
  private policy: SecurityPolicy;
  private auditLog: AuditEntry[] = [];
  private blockedAgents: Set<string> = new Set();

  constructor(policy?: Partial<SecurityPolicy>) {
    super();
    this.policy = {
      allowedCommands: policy?.allowedCommands ?? [
        'git', 'npm', 'node', 'python3', 'echo', 'cat', 'ls', 'mkdir', 'touch'
      ],
      blockedPatterns: policy?.blockedPatterns ?? [
        'rm\\s+-rf\\s+/',
        'sudo\\s+',
        ':\\(\\)\\{\\|'
      ],
      maxFileSizeMB: policy?.maxFileSizeMB ?? 10,
      sandboxEnabled: policy?.sandboxEnabled ?? true
    };
  }

  async validateCommand(command: string, agentId: string): Promise<boolean> {
    if (this.blockedAgents.has(agentId)) {
      this.audit('agent_blocked', agentId, { command, reason: 'agent_in_blocklist' });
      return false;
    }

    const cmd = command.trim().split(/\s+/)[0];

    if (!this.policy.allowedCommands.includes(cmd)) {
      this.audit('command_blocked', agentId, { command, reason: 'not_in_allowlist' });
      return false;
    }

    for (const pattern of this.policy.blockedPatterns) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(command)) {
        this.audit('command_blocked', agentId, { command, reason: 'blocked_pattern', pattern });
        return false;
      }
    }

    this.audit('command_allowed', agentId, { command });
    return true;
  }

  async validateFileWrite(
    filePath: string,
    content: string,
    agentId: string
  ): Promise<boolean> {
    if (this.blockedAgents.has(agentId)) {
      this.audit('file_write_blocked', agentId, { filePath, reason: 'agent_blocked' });
      return false;
    }

    try {
      const resolved = path.resolve(filePath);
      const cwd = process.cwd();
      if (!resolved.startsWith(cwd)) {
        this.audit('file_write_blocked', agentId, { filePath, reason: 'path_traversal' });
        return false;
      }
    } catch {
      this.audit('file_write_blocked', agentId, { filePath, reason: 'invalid_path' });
      return false;
    }

    const sizeMB = Buffer.byteLength(content, 'utf8') / 1024 / 1024;
    if (sizeMB > this.policy.maxFileSizeMB) {
      this.audit('file_write_blocked', agentId, { filePath, reason: 'size_limit', size: sizeMB });
      return false;
    }

    const blockedExtensions = ['.exe', '.sh', '.bat', '.cmd', '.ps1'];
    const ext = path.extname(filePath).toLowerCase();
    if (blockedExtensions.includes(ext)) {
      this.audit('file_write_blocked', agentId, { filePath, reason: 'blocked_extension', ext });
      return false;
    }

    this.audit('file_write_allowed', agentId, { filePath, sizeMB });
    return true;
  }

  async validateNetworkRequest(
    url: string,
    agentId: string
  ): Promise<boolean> {
    try {
      const urlObj = new URL(url);
      const allowedProtocols = ['http:', 'https:', 'file:'];

      if (!allowedProtocols.includes(urlObj.protocol)) {
        this.audit('network_blocked', agentId, { url, reason: 'disallowed_protocol' });
        return false;
      }

      this.audit('network_allowed', agentId, { url });
      return true;
    } catch {
      this.audit('network_blocked', agentId, { url, reason: 'invalid_url' });
      return false;
    }
  }

  blockAgent(agentId: string, reason?: string): void {
    this.blockedAgents.add(agentId);
    this.emit('agent_blocked', { agentId, reason });
    this.audit('agent_blocked', 'system', { agentId, reason: reason ?? 'manual' });
  }

  unblockAgent(agentId: string): void {
    this.blockedAgents.delete(agentId);
    this.emit('agent_unblocked', { agentId });
    this.audit('agent_unblocked', 'system', { agentId });
  }

  isAgentBlocked(agentId: string): boolean {
    return this.blockedAgents.has(agentId);
  }

  generateAuditTrail(limit?: number): string {
    const entries = limit ? this.auditLog.slice(-limit) : this.auditLog;
    return JSON.stringify(entries, null, 2);
  }

  getRecentSecurityEvents(count: number = 10): AuditEntry[] {
    return this.auditLog.slice(-count);
  }

  private audit(
    action: string,
    agentId: string,
    details: Record<string, unknown>
  ): void {
    const entry: AuditEntry = {
      timestamp: Date.now(),
      action,
      agentId,
      details
    };

    this.auditLog.push(entry);

    if (this.auditLog.length > 1000) {
      this.auditLog.shift();
    }

    if (action.includes('blocked')) {
      this.emit('security_event', entry);
    }
  }

  getSecurityMetrics() {
    const blocked = this.auditLog.filter(e => e.action.includes('blocked')).length;
    const allowed = this.auditLog.filter(e => e.action.includes('allowed')).length;

    return {
      totalEvents: this.auditLog.length,
      blockedEvents: blocked,
      allowedEvents: allowed,
      blockedAgents: this.blockedAgents.size
    };
  }

  updatePolicy(updates: Partial<SecurityPolicy>): void {
    this.policy = { ...this.policy, ...updates };
    this.emit('policy_updated', this.policy);
  }

  getPolicy(): SecurityPolicy {
    return { ...this.policy };
  }
}