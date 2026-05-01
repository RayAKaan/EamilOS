import { AuditEvent } from '../auth/types.js';
import { nanoid } from 'nanoid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type AuditEventType = 'auth' | 'team' | 'resource' | 'cost' | 'security';
export type AuditEventResult = 'success' | 'failure';

export class AuditLogger {
  private logDir: string;
  private events: AuditEvent[] = [];
  private maxEvents: number;

  constructor(logDir?: string, maxEvents = 100000) {
    this.logDir = logDir || path.join(os.homedir(), '.eamilos', 'audit');
    this.maxEvents = maxEvents;
    this.ensureDir();
    this.loadEvents();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private filePath(): string {
    return path.join(this.logDir, 'events.json');
  }

  private loadEvents(): void {
    this.events = [];
    if (!fs.existsSync(this.filePath())) return;

    try {
      const data = fs.readFileSync(this.filePath(), 'utf-8');
      this.events = JSON.parse(data) as AuditEvent[];
    } catch {
      this.events = [];
    }
  }

  private saveEvents(): void {
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
    fs.writeFileSync(this.filePath(), JSON.stringify(this.events, null, 2), 'utf-8');
  }

  log(
    profileId: string,
    type: AuditEventType,
    action: string,
    details: Record<string, unknown>,
    result: AuditEventResult = 'success',
    teamId: string | null = null,
  ): AuditEvent {
    const event: AuditEvent = {
      id: nanoid(12),
      timestamp: Date.now(),
      profileId,
      teamId,
      type,
      action,
      details,
      result,
    };

    this.events.push(event);
    this.saveEvents();
    return event;
  }

  logAuth(profileId: string, action: string, details: Record<string, unknown> = {}, result: AuditEventResult = 'success'): AuditEvent {
    return this.log(profileId, 'auth', action, details, result);
  }

  logTeam(profileId: string, teamId: string, action: string, details: Record<string, unknown> = {}, result: AuditEventResult = 'success'): AuditEvent {
    return this.log(profileId, 'team', action, details, result, teamId);
  }

  logResource(profileId: string, action: string, details: Record<string, unknown> = {}, teamId: string | null = null): AuditEvent {
    return this.log(profileId, 'resource', action, details, 'success', teamId);
  }

  logCost(profileId: string, cost: number, details: Record<string, unknown> = {}, teamId: string | null = null): AuditEvent {
    return this.log(profileId, 'cost', 'cost_recorded', { ...details, amount: cost }, 'success', teamId);
  }

  logSecurity(profileId: string, action: string, details: Record<string, unknown> = {}, result: AuditEventResult = 'success'): AuditEvent {
    return this.log(profileId, 'security', action, details, result);
  }

  getEvents(options: {
    profileId?: string;
    teamId?: string;
    type?: AuditEventType;
    action?: string;
    result?: AuditEventResult;
    from?: number;
    to?: number;
    limit?: number;
  } = {}): AuditEvent[] {
    let filtered = this.events;

    if (options.profileId) {
      filtered = filtered.filter(e => e.profileId === options.profileId);
    }
    if (options.teamId) {
      filtered = filtered.filter(e => e.teamId === options.teamId);
    }
    if (options.type) {
      filtered = filtered.filter(e => e.type === options.type);
    }
    if (options.action) {
      filtered = filtered.filter(e => e.action === options.action);
    }
    if (options.result) {
      filtered = filtered.filter(e => e.result === options.result);
    }
    if (options.from) {
      filtered = filtered.filter(e => e.timestamp >= options.from!);
    }
    if (options.to) {
      filtered = filtered.filter(e => e.timestamp <= options.to!);
    }

    filtered = filtered.sort((a, b) => b.timestamp - a.timestamp);

    if (options.limit && options.limit > 0) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  getEventCount(): number {
    return this.events.length;
  }

  getEventsByType(type: AuditEventType): AuditEvent[] {
    return this.events.filter(e => e.type === type).sort((a, b) => b.timestamp - a.timestamp);
  }

  getFailedEvents(): AuditEvent[] {
    return this.events.filter(e => e.result === 'failure').sort((a, b) => b.timestamp - a.timestamp);
  }

  purgeOlderThan(timestamp: number): number {
    const before = this.events.length;
    this.events = this.events.filter(e => e.timestamp >= timestamp);
    this.saveEvents();
    return before - this.events.length;
  }
}

let globalAuditLogger: AuditLogger | null = null;

export function initAuditLogger(dir?: string, maxEvents?: number): AuditLogger {
  globalAuditLogger = new AuditLogger(dir, maxEvents);
  return globalAuditLogger;
}

export function getAuditLogger(): AuditLogger {
  if (!globalAuditLogger) {
    return initAuditLogger();
  }
  return globalAuditLogger;
}
