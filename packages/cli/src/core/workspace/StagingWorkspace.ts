import { mkdtempSync, cpSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

export interface StagingSession {
  id: string;
  agentId: string;
  sessionDir: string;
  agentDir: string;
  workspaceDir: string;
  originalDir: string;
}

export class StagingWorkspace {
  private baseDir: string;
  private sessions: Map<string, StagingSession> = new Map();

  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(process.cwd(), '.eamilos', 'sessions');
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  createSession(agentId: string, originalDir: string): StagingSession {
    const sessionDir = mkdtempSync(join(this.baseDir, `session_`));
    const agentDir = join(sessionDir, 'agents', agentId, 'workspace');
    mkdirSync(agentDir, { recursive: true });

    if (existsSync(originalDir)) {
      try {
        const entries = readdirSync(originalDir);
        for (const entry of entries) {
          if (entry === '.git' || entry === 'node_modules') continue;
          const src = join(originalDir, entry);
          const dst = join(agentDir, entry);
          try {
            cpSync(src, dst, { recursive: true, force: true });
          } catch { }
        }
      } catch { }
    }

    const session: StagingSession = {
      id: `stg_${agentId}_${Date.now()}`,
      agentId,
      sessionDir,
      agentDir,
      workspaceDir: agentDir,
      originalDir,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): StagingSession | undefined {
    return this.sessions.get(id);
  }

  getSessionByAgent(agentId: string): StagingSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.agentId === agentId) return session;
    }
    return undefined;
  }

  getWorkspaceDir(agentId: string): string {
    const session = this.getSessionByAgent(agentId);
    return session ? session.workspaceDir : '';
  }

  cleanupSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      try { rmSync(session.sessionDir, { recursive: true, force: true }); } catch { }
      this.sessions.delete(id);
    }
  }

  cleanupAll(): void {
    for (const [id] of this.sessions) {
      this.cleanupSession(id);
    }
  }
}

let globalStaging: StagingWorkspace | null = null;

export function getStagingWorkspace(): StagingWorkspace {
  if (!globalStaging) {
    globalStaging = new StagingWorkspace();
  }
  return globalStaging;
}
