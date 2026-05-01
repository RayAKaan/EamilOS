import { AuditLogger, AuditEventType } from './logger.js';
import * as fs from 'fs';

export interface ReportOptions {
  from?: number;
  to?: number;
  teamId?: string;
  profileId?: string;
  type?: AuditEventType;
}

export interface ReportSummary {
  totalEvents: number;
  byType: Record<string, number>;
  byResult: Record<string, number>;
  byProfile: Record<string, number>;
  timeRange: { start: number; end: number };
  failureRate: number;
}

export class AuditReporter {
  private logger: AuditLogger;

  constructor(logger: AuditLogger) {
    this.logger = logger;
  }

  generateSummary(options: ReportOptions = {}): ReportSummary {
    const events = this.logger.getEvents(options);

    const byType: Record<string, number> = {};
    const byResult: Record<string, number> = {};
    const byProfile: Record<string, number> = {};

    for (const event of events) {
      byType[event.type] = (byType[event.type] || 0) + 1;
      byResult[event.result] = (byResult[event.result] || 0) + 1;
      byProfile[event.profileId] = (byProfile[event.profileId] || 0) + 1;
    }

    const failures = byResult['failure'] || 0;
    const failureRate = events.length > 0 ? failures / events.length : 0;

    return {
      totalEvents: events.length,
      byType,
      byResult,
      byProfile,
      timeRange: {
        start: events.length > 0 ? Math.min(...events.map(e => e.timestamp)) : Date.now(),
        end: events.length > 0 ? Math.max(...events.map(e => e.timestamp)) : Date.now(),
      },
      failureRate,
    };
  }

  exportJSON(options: ReportOptions = {}): string {
    const events = this.logger.getEvents(options);
    return JSON.stringify({
      exportedAt: Date.now(),
      count: events.length,
      events,
    }, null, 2);
  }

  exportCSV(options: ReportOptions = {}): string {
    const events = this.logger.getEvents(options);
    const headers = ['id', 'timestamp', 'profileId', 'teamId', 'type', 'action', 'result', 'details'];
    const rows = events.map(e => [
      e.id,
      new Date(e.timestamp).toISOString(),
      e.profileId,
      e.teamId || '',
      e.type,
      e.action,
      e.result,
      JSON.stringify(e.details).replace(/"/g, '""'),
    ]);

    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(row.map(cell => `"${cell}"`).join(','));
    }

    return lines.join('\n');
  }

  exportToFile(path: string, format: 'json' | 'csv' = 'json', options: ReportOptions = {}): void {
    const content = format === 'json' ? this.exportJSON(options) : this.exportCSV(options);
    fs.writeFileSync(path, content, 'utf-8');
  }

  generateDailyReport(date: Date, teamId?: string): ReportSummary {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    return this.generateSummary({
      from: start.getTime(),
      to: end.getTime(),
      teamId,
    });
  }

  generateWeeklyReport(weekStart: Date, teamId?: string): ReportSummary {
    const start = new Date(weekStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return this.generateSummary({
      from: start.getTime(),
      to: end.getTime(),
      teamId,
    });
  }
}

let globalAuditReporter: AuditReporter | null = null;

export function initAuditReporter(logger?: AuditLogger): AuditReporter {
  if (!logger) {
    const { getAuditLogger } = require('./logger.js');
    logger = getAuditLogger();
  }
  globalAuditReporter = new AuditReporter(logger!);
  return globalAuditReporter;
}

export function getAuditReporter(): AuditReporter {
  if (!globalAuditReporter) {
    return initAuditReporter();
  }
  return globalAuditReporter;
}
