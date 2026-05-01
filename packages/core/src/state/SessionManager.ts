import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string;
  timestamp: number;
}

export interface SessionContext {
  activeProjectId: string | null;
  activeProjectName: string | null;
  agentId: string | null;
  [key: string]: unknown;
}

export interface AppSession {
  id: string;
  name: string;
  version: string;
  createdAt: number;
  updatedAt: number;
  metadata: {
    eamilosVersion: string;
    nodeVersion: string;
    platform: string;
    profileId?: string;
  };
  data: {
    messages: SessionMessage[];
    context: SessionContext;
    taskCount: number;
    completedTasks: number;
  };
}

export interface SessionManagerConfig {
  maxSessions: number;
  encrypt: boolean;
}

const DEFAULT_CONFIG: SessionManagerConfig = {
  maxSessions: 20,
  encrypt: false,
};

export class SessionManager {
  private config: SessionManagerConfig;
  private sessionsDir: string;
  private currentSessionId: string;
  private encryptionKey?: Buffer;
  private autoSaveInterval?: NodeJS.Timeout;
  private messages: SessionMessage[] = [];
  private context: SessionContext = {
    activeProjectId: null,
    activeProjectName: null,
    agentId: null,
  };

  constructor(profileId: string, config?: Partial<SessionManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentSessionId = 'default';
    this.sessionsDir = path.join(os.homedir(), '.eamilos', 'sessions', profileId);

    if (this.config.encrypt) {
      this.encryptionKey = this.loadOrCreateKey();
    }
  }

  private loadOrCreateKey(): Buffer {
    const keyPath = path.join(os.homedir(), '.eamilos', '.session-key');
    if (fsSync.existsSync(keyPath)) {
      return Buffer.from(fsSync.readFileSync(keyPath, 'utf-8'), 'hex');
    }
    const key = crypto.randomBytes(32);
    fsSync.mkdirSync(path.dirname(keyPath), { recursive: true });
    fsSync.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
    return key;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
  }

  setMessages(messages: SessionMessage[]): void {
    this.messages = messages;
  }

  setContext(context: Partial<SessionContext>): void {
    this.context = { ...this.context, ...context };
  }

  getMessages(): SessionMessage[] {
    return this.messages;
  }

  getContext(): SessionContext {
    return this.context;
  }

  async save(sessionId?: string): Promise<string> {
    const id = sessionId || this.currentSessionId;
    await fs.mkdir(this.sessionsDir, { recursive: true });

    const session: AppSession = {
      id,
      name: id,
      version: '1.0',
      createdAt: await this.getCreatedAt(id),
      updatedAt: Date.now(),
      metadata: {
        eamilosVersion: '1.2.8',
        nodeVersion: process.version,
        platform: process.platform,
      },
      data: {
        messages: this.messages,
        context: this.context,
        taskCount: 0,
        completedTasks: 0,
      },
    };

    let data = JSON.stringify(session);

    if (this.config.encrypt && this.encryptionKey) {
      data = this.encryptData(data);
    }

    const sessionPath = this.getSessionPath(id);
    const tempPath = `${sessionPath}.tmp`;

    await fs.writeFile(tempPath, data, 'utf-8');

    const backupPath = `${sessionPath}.backup`;
    try {
      await fs.access(sessionPath);
      await fs.copyFile(sessionPath, backupPath);
    } catch {
      // No existing file to back up
    }

    await fs.rename(tempPath, sessionPath);
    await this.updateIndex(id, session.updatedAt);

    return sessionPath;
  }

  async load(sessionId?: string): Promise<AppSession | null> {
    const id = sessionId || this.currentSessionId;
    const sessionPath = this.getSessionPath(id);

    try {
      await fs.access(sessionPath);
    } catch {
      return null;
    }

    let data = await fs.readFile(sessionPath, 'utf-8');

    if (this.config.encrypt && this.encryptionKey && data.startsWith('{')) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.iv && parsed.data) {
          data = this.decryptData(data);
        }
      } catch {
        // Not encrypted, continue
      }
    }

    const session: AppSession = JSON.parse(data);
    return session;
  }

  async restore(sessionId?: string): Promise<boolean> {
    const session = await this.load(sessionId);
    if (!session) return false;

    this.messages = session.data.messages || [];
    this.context = session.data.context || this.context;
    this.currentSessionId = session.id;
    return true;
  }

  async list(): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
      const files = await fs.readdir(this.sessionsDir);
      const sessions: Array<{ id: string; name: string; updatedAt: number }> = [];

      for (const file of files) {
        if (file === 'index.json') continue;
        if (file.endsWith('.json') || file.endsWith('.json.enc')) {
          const sessionId = file.replace(/\.json(\.enc)?$/, '');
          try {
            const stat = await fs.stat(path.join(this.sessionsDir, file));
            sessions.push({
              id: sessionId,
              name: sessionId,
              updatedAt: stat.mtimeMs,
            });
          } catch {
            // Skip corrupted files
          }
        }
      }

      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      return sessions;
    } catch {
      return [];
    }
  }

  async delete(sessionId: string): Promise<boolean> {
    try {
      const sessionPath = this.getSessionPath(sessionId);
      await fs.unlink(sessionPath);
      const backupPath = `${sessionPath}.backup`;
      try {
        await fs.unlink(backupPath);
      } catch {
        // No backup
      }
      return true;
    } catch {
      return false;
    }
  }

  async create(name: string): Promise<string> {
    const sessionId = name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase() || `session-${Date.now()}`;
    this.messages = [];
    this.context = {
      activeProjectId: null,
      activeProjectName: null,
      agentId: null,
    };
    this.currentSessionId = sessionId;
    await this.save(sessionId);
    return sessionId;
  }

  setCurrentSession(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  getCurrentSession(): string {
    return this.currentSessionId;
  }

  startAutoSave(intervalMs: number = 30000): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = setInterval(() => {
      this.save().catch(() => {});
    }, intervalMs);
  }

  stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = undefined;
    }
  }

  async cleanup(): Promise<number> {
    const sessions = await this.list();
    if (sessions.length <= this.config.maxSessions) return 0;

    const toDelete = sessions.slice(this.config.maxSessions);
    let deleted = 0;

    for (const session of toDelete) {
      const result = await this.delete(session.id);
      if (result) deleted++;
    }

    return deleted;
  }

  async getHealthReport(): Promise<{
    totalSessions: number;
    totalSize: number;
    corrupted: number;
  }> {
    const sessions = await this.list();
    let totalSize = 0;
    let corrupted = 0;

    for (const session of sessions) {
      try {
        const sessionPath = this.getSessionPath(session.id);
        const stat = await fs.stat(sessionPath);
        totalSize += stat.size;
      } catch {
        corrupted++;
      }
    }

    return {
      totalSessions: sessions.length,
      totalSize,
      corrupted,
    };
  }

  private getSessionPath(sessionId: string): string {
    const ext = this.config.encrypt ? '.json.enc' : '.json';
    return path.join(this.sessionsDir, `${sessionId}${ext}`);
  }

  private async getCreatedAt(sessionId: string): Promise<number> {
    try {
      const sessionPath = this.getSessionPath(sessionId);
      const stat = await fs.stat(sessionPath);
      return stat.birthtimeMs;
    } catch {
      return Date.now();
    }
  }

  private encryptData(data: string): string {
    if (!this.encryptionKey) return data;

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(data, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return JSON.stringify({
      iv: iv.toString('hex'),
      authTag,
      data: encrypted,
    });
  }

  private decryptData(encrypted: string): string {
    if (!this.encryptionKey) return encrypted;

    const parsed = JSON.parse(encrypted);
    const iv = Buffer.from(parsed.iv, 'hex');
    const authTag = Buffer.from(parsed.authTag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(parsed.data, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    return decrypted;
  }

  private async updateIndex(sessionId: string, updatedAt: number): Promise<void> {
    const indexPath = path.join(this.sessionsDir, 'index.json');
    let index: Record<string, number> = {};

    try {
      const data = await fs.readFile(indexPath, 'utf-8');
      index = JSON.parse(data);
    } catch {
      // Index doesn't exist
    }

    index[sessionId] = updatedAt;

    const sorted = Object.entries(index)
      .sort(([, a], [, b]) => b - a)
      .slice(0, this.config.maxSessions);

    await fs.writeFile(indexPath, JSON.stringify(Object.fromEntries(sorted), null, 2), 'utf-8');
  }
}

let globalSessionManager: SessionManager | null = null;

export function initSessionManager(profileId: string, config?: Partial<SessionManagerConfig>): SessionManager {
  globalSessionManager = new SessionManager(profileId, config);
  return globalSessionManager;
}

export function getSessionManager(): SessionManager | null {
  return globalSessionManager;
}
