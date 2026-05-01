import { describe, it, expect, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { AuditLogger } from '../../src/audit/logger.js';
import { AuditReporter } from '../../src/audit/reporter.js';
import { ComplianceManager } from '../../src/audit/compliance.js';
import { ProfileManager } from '../../src/auth/index.js';
import { KeyVault } from '../../src/auth/key-vault.js';
import { TeamManager } from '../../src/teams/manager.js';

describe('AuditLogger', () => {
  let tmpDir: string;
  let logger: AuditLogger;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `eamilos-audit-${Date.now()}`);
    logger = new AuditLogger(tmpDir);
  });

  it('logs an event', () => {
    const event = logger.log('profile-1', 'auth', 'login', { provider: 'openai' });
    expect(event.profileId).toBe('profile-1');
    expect(event.type).toBe('auth');
    expect(event.action).toBe('login');
    expect(event.result).toBe('success');
  });

  it('logs different event types', () => {
    logger.logAuth('profile-1', 'login');
    logger.logTeam('profile-1', 'team-1', 'invite_sent');
    logger.logResource('profile-1', 'agent_created');
    logger.logCost('profile-1', 0.05);
    logger.logSecurity('profile-1', 'key_rotated');

    expect(logger.getEventCount()).toBe(5);
  });

  it('filters events by type', () => {
    logger.log('profile-1', 'auth', 'login', {});
    logger.log('profile-1', 'team', 'invite_sent', {});
    logger.log('profile-1', 'auth', 'logout', {});

    const authEvents = logger.getEvents({ type: 'auth' });
    expect(authEvents.length).toBe(2);
  });

  it('filters events by result', () => {
    logger.log('profile-1', 'auth', 'login', {}, 'success');
    logger.log('profile-1', 'auth', 'login_failed', {}, 'failure');

    const failed = logger.getFailedEvents();
    expect(failed.length).toBe(1);
  });

  it('limits results', () => {
    for (let i = 0; i < 10; i++) {
      logger.log('profile-1', 'auth', `action-${i}`, {});
    }
    const limited = logger.getEvents({ limit: 5 });
    expect(limited.length).toBe(5);
  });

  it('gets events by profile', () => {
    logger.log('profile-1', 'auth', 'login', {});
    logger.log('profile-2', 'auth', 'login', {});

    const events = logger.getEvents({ profileId: 'profile-1' });
    expect(events.length).toBe(1);
  });

  it('purges older events', () => {
    logger.log('profile-1', 'auth', 'old-event', {});
    const removed = logger.purgeOlderThan(Date.now() + 1000);
    expect(removed).toBe(1);
    expect(logger.getEventCount()).toBe(0);
  });
});

describe('AuditReporter', () => {
  let tmpDir: string;
  let logger: AuditLogger;
  let reporter: AuditReporter;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `eamilos-reporter-${Date.now()}`);
    logger = new AuditLogger(tmpDir);
    reporter = new AuditReporter(logger);
  });

  it('generates summary', () => {
    logger.log('profile-1', 'auth', 'login', {});
    logger.log('profile-1', 'team', 'invite', {});
    logger.log('profile-2', 'auth', 'login', {}, 'failure');

    const summary = reporter.generateSummary();
    expect(summary.totalEvents).toBe(3);
    expect(summary.byType['auth']).toBe(2);
    expect(summary.byType['team']).toBe(1);
    expect(summary.byResult['failure']).toBe(1);
    expect(summary.failureRate).toBeCloseTo(1 / 3, 2);
  });

  it('exports JSON', () => {
    logger.log('profile-1', 'auth', 'login', {});
    const json = reporter.exportJSON();
    const parsed = JSON.parse(json);
    expect(parsed.count).toBe(1);
    expect(parsed.events[0].action).toBe('login');
  });

  it('exports CSV', () => {
    logger.log('profile-1', 'auth', 'login', { detail: 'test' });
    const csv = reporter.exportCSV();
    expect(csv).toContain('id,timestamp,profileId');
    expect(csv).toContain('login');
  });

  it('exports to file', () => {
    logger.log('profile-1', 'auth', 'login', {});
    const filePath = path.join(tmpDir, 'test-export.json');
    reporter.exportToFile(filePath, 'json');
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe('ComplianceManager', () => {
  let tmpDir: string;
  let logger: AuditLogger;
  let pm: ProfileManager;
  let kv: KeyVault;
  let tm: TeamManager;
  let compliance: ComplianceManager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `eamilos-compliance-${Date.now()}`);
    logger = new AuditLogger(path.join(tmpDir, 'audit'));
    pm = new ProfileManager(path.join(tmpDir, 'profiles'));
    kv = new KeyVault(path.join(tmpDir, 'vault'));
    tm = new TeamManager(path.join(tmpDir, 'teams'));
    compliance = new ComplianceManager(logger, pm, kv, tm, 30);
  });

  it('generates compliance report', () => {
    pm.createProfile('user1', 'user1@example.com');
    const report = compliance.generateComplianceReport();
    expect(report.profileDataExported).toBe(1);
    expect(report.retentionPeriodDays).toBe(30);
  });

  it('exports profile data', () => {
    const profile = pm.createProfile('user1', 'user1@example.com');
    kv.setKey(profile.id, 'openai', 'sk-test');
    const data = compliance.exportProfileData(profile.id);
    expect(data).not.toBeNull();
    const parsed = JSON.parse(data!);
    expect(parsed.profile.profile.name).toBe('user1');
  });

  it('deletes profile compliance', () => {
    const profile = pm.createProfile('user1', 'user1@example.com');
    kv.setKey(profile.id, 'openai', 'sk-test');
    const result = compliance.deleteProfileCompliance(profile.id);
    expect(result.profileDeleted).toBe(true);
    expect(result.keysWiped).toBe(true);
  });

  it('purges old audit logs', () => {
    logger.log('profile-1', 'auth', 'login', {});
    const removed = compliance.purgeAuditLogs(1);
    expect(removed).toBe(0);
  });

  it('checks compliance', () => {
    pm.createProfile('user1', 'user1@example.com');
    const check = compliance.checkCompliance();
    expect(check.compliant).toBe(true);
    expect(check.issues.length).toBe(0);
  });

  it('sets retention period', () => {
    expect(compliance.getRetentionPeriodDays()).toBe(30);
    compliance.setRetentionPeriod(90);
    expect(compliance.getRetentionPeriodDays()).toBe(90);
  });
});
