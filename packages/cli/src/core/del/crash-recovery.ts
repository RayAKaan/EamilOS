import { existsSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { Session, SessionStatus, CrashRecoveryResult, FileResult } from './stateful-types.js';
import { StatePersistence } from './persistence.js';

export interface RecoveryOptions {
  workspaceRoot: string;
  deleteTempFiles: boolean;
  maxAgeMs: number;
}

const DEFAULT_RECOVERY_OPTIONS: RecoveryOptions = {
  workspaceRoot: process.cwd(),
  deleteTempFiles: true,
  maxAgeMs: 24 * 60 * 60 * 1000,
};

export class CrashRecoveryManager {
  private persistence: StatePersistence;
  private options: RecoveryOptions;

  constructor(
    persistence: StatePersistence,
    options: Partial<RecoveryOptions> = {}
  ) {
    this.persistence = persistence;
    this.options = { ...DEFAULT_RECOVERY_OPTIONS, ...options };
  }

  scanForCrashedSessions(): Session[] {
    return this.persistence.getActiveSessions();
  }

  recoverSession(sessionId: string): CrashRecoveryResult {
    const session = this.persistence.loadSession(sessionId);
    if (!session) {
      return {
        sessionId,
        recoveredFiles: [],
        rolledBackFiles: [],
        status: 'failed',
        canResume: false,
      };
    }

    const recoveredFiles: string[] = [];
    const rolledBackFiles: string[] = [];

    const pendingWALEntries = this.persistence.getPendingWALEntries(sessionId);

    for (const entry of pendingWALEntries) {
      const tempPath = join(this.options.workspaceRoot, entry.path + '.tmp');

      if (existsSync(tempPath)) {
        if (this.options.deleteTempFiles) {
          try {
            rmSync(tempPath);
            rolledBackFiles.push(entry.path);
          } catch {
          }
        }
      }

      this.persistence.rollbackWALEntry(entry.id!);
    }

    const successfulFiles = session.execution.files.filter(f => f.status === 'success');
    for (const file of successfulFiles) {
      const filePath = join(this.options.workspaceRoot, file.path);
      if (existsSync(filePath)) {
        recoveredFiles.push(file.path);
      }
    }

    const now = Date.now();
    const sessionAge = now - session.updatedAt;
    const isStale = sessionAge > this.options.maxAgeMs;

    let newStatus: SessionStatus;
    let canResume: boolean;

    if (isStale) {
      newStatus = 'failed';
      canResume = false;
    } else {
      newStatus = 'recovering';
      canResume = true;
    }

    session.status = newStatus;
    session.updatedAt = now;
    this.persistence.saveSessionSync(session);

    return {
      sessionId,
      recoveredFiles,
      rolledBackFiles,
      status: newStatus,
      canResume,
    };
  }

  recoverAllCrashedSessions(): CrashRecoveryResult[] {
    const crashedSessions = this.scanForCrashedSessions();
    const results: CrashRecoveryResult[] = [];

    for (const session of crashedSessions) {
      const result = this.recoverSession(session.id);
      results.push(result);
    }

    return results;
  }

  cleanupOrphanedTempFiles(): string[] {
    const cleanedFiles: string[] = [];

    if (!existsSync(this.options.workspaceRoot)) {
      return cleanedFiles;
    }

    try {
      const entries = readdirSync(this.options.workspaceRoot, { recursive: true });

      for (const entry of entries) {
        if (typeof entry !== 'string') continue;

        const fullPath = join(this.options.workspaceRoot, entry);

        if (!entry.endsWith('.tmp')) continue;

        try {
          const stat = statSync(fullPath);
          const age = Date.now() - stat.mtimeMs;

          if (age > this.options.maxAgeMs) {
            if (this.options.deleteTempFiles) {
              rmSync(fullPath);
              cleanedFiles.push(entry);
            }
          }
        } catch {
        }
      }
    } catch {
    }

    return cleanedFiles;
  }

  markSessionAsRecovering(sessionId: string): void {
    const session = this.persistence.loadSession(sessionId);
    if (session) {
      session.status = 'recovering';
      session.updatedAt = Date.now();
      this.persistence.saveSessionSync(session);
    }
  }

  markSessionAsResumable(sessionId: string): void {
    const session = this.persistence.loadSession(sessionId);
    if (session) {
      session.status = 'running';
      session.updatedAt = Date.now();
      this.persistence.saveSessionSync(session);
    }
  }

  markSessionAsFailed(sessionId: string): void {
    const session = this.persistence.loadSession(sessionId);
    if (session) {
      session.status = 'failed';
      session.updatedAt = Date.now();
      this.persistence.saveSessionSync(session);
    }
  }

  getFailedFilesForRetry(session: Session): FileResult[] {
    return session.execution.files.filter(f => f.status === 'failed');
  }

  getPendingFiles(session: Session): FileResult[] {
    return session.execution.files.filter(f => f.status === 'pending');
  }

  generateRecoverySummary(result: CrashRecoveryResult): string {
    const parts: string[] = [];

    if (result.status === 'recovering' && result.canResume) {
      parts.push(`Session ${result.sessionId} can be resumed.`);
    } else if (result.status === 'failed') {
      parts.push(`Session ${result.sessionId} is too old to recover.`);
    }

    if (result.recoveredFiles.length > 0) {
      parts.push(`Recovered ${result.recoveredFiles.length} successfully written files.`);
    }

    if (result.rolledBackFiles.length > 0) {
      parts.push(`Rolled back ${result.rolledBackFiles.length} incomplete writes.`);
    }

    return parts.join(' ');
  }
}

export function createCrashRecoveryManager(
  persistence: StatePersistence,
  options?: Partial<RecoveryOptions>
): CrashRecoveryManager {
  return new CrashRecoveryManager(persistence, options);
}
