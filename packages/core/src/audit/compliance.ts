import { AuditLogger } from './logger.js';
import { ProfileManager } from '../auth/index.js';
import { KeyVault } from '../auth/key-vault.js';
import { TeamManager } from '../teams/manager.js';

export interface ComplianceReport {
  profileDataExported: number;
  profileDataDeleted: number;
  auditLogsPurged: number;
  keysWiped: number;
  retentionPeriodDays: number;
  generatedAt: number;
}

export class ComplianceManager {
  private logger: AuditLogger;
  private profileManager: ProfileManager;
  private keyVault: KeyVault;
  private teamManager: TeamManager;
  private retentionDays: number;

  constructor(
    logger: AuditLogger,
    profileManager: ProfileManager,
    keyVault: KeyVault,
    teamManager: TeamManager,
    retentionDays = 365,
  ) {
    this.logger = logger;
    this.profileManager = profileManager;
    this.keyVault = keyVault;
    this.teamManager = teamManager;
    this.retentionDays = retentionDays;
  }

  exportProfileData(profileId: string): string | null {
    const profileData = this.profileManager.exportProfileData(profileId);
    if (!profileData) return null;

    const keys = this.keyVault.listKeys(profileId);
    const teams = this.teamManager.getUserTeams(profileId);

    return JSON.stringify({
      profile: JSON.parse(profileData),
      apiKeys: keys.map(k => ({ provider: k.provider, hasStored: true })),
      teams: teams.map(t => ({
        name: t.team.name,
        role: t.member.role,
        joinedAt: t.member.joinedAt,
      })),
      exportedAt: Date.now(),
      purpose: 'GDPR Data Export',
    }, null, 2);
  }

  deleteProfileCompliance(profileId: string): {
    profileDeleted: boolean;
    keysWiped: boolean;
    auditLogsRemoved: number;
  } {
    this.keyVault.wipeProfile(profileId);

    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    const removed = this.logger.purgeOlderThan(cutoff);

    const deleted = this.profileManager.deleteProfile(profileId);

    return {
      profileDeleted: deleted,
      keysWiped: true,
      auditLogsRemoved: removed,
    };
  }

  purgeAuditLogs(olderThanDays?: number): number {
    const days = olderThanDays || this.retentionDays;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.logger.purgeOlderThan(cutoff);
  }

  generateComplianceReport(): ComplianceReport {
    const profiles = this.profileManager.listProfiles();
    let exportedCount = 0;
    let deletedCount = 0;

    for (const profile of profiles) {
      if (profile.lastActive < Date.now() - this.retentionDays * 24 * 60 * 60 * 1000) {
        deletedCount++;
      } else {
        exportedCount++;
      }
    }

    return {
      profileDataExported: exportedCount,
      profileDataDeleted: deletedCount,
      auditLogsPurged: 0,
      keysWiped: 0,
      retentionPeriodDays: this.retentionDays,
      generatedAt: Date.now(),
    };
  }

  getRetentionPeriodDays(): number {
    return this.retentionDays;
  }

  setRetentionPeriod(days: number): void {
    this.retentionDays = days;
  }

  checkCompliance(): {
    compliant: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    const profiles = this.profileManager.listProfiles();
    for (const profile of profiles) {
      if (profile.lastActive < Date.now() - this.retentionDays * 24 * 60 * 60 * 1000) {
        issues.push(`Profile '${profile.name}' (${profile.id}) has been inactive for over ${this.retentionDays} days`);
      }
    }

    const failedEvents = this.logger.getFailedEvents();
    if (failedEvents.length > 100) {
      issues.push(`High number of failed audit events: ${failedEvents.length}`);
    }

    return {
      compliant: issues.length === 0,
      issues,
    };
  }
}
