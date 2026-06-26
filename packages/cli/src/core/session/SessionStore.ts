import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

export interface RecordedSession {
  id: string;
  timestamp: number;
  prompt: string;
  mode: string;
  strategy: string;
  detectedAgents: string[];
  selectedAgents: string[];
  fallbacks: string[];
  subtasks: string[];
  terminalOutput: string[];
  fileChanges: Array<{ path: string; action: string; hash?: string }>;
  validationResults: Array<{ path: string; valid: boolean; errors: string[] }>;
  approvalDecisions: Array<{ action: string; approved: boolean; reason: string }>;
  finalResult: {
    success: boolean;
    agentUsed?: string;
    durationMs: number;
    errors: string[];
  };
}

export class SessionStore {
  private baseDir: string;
  private currentSession: RecordedSession | null = null;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(process.cwd(), '.eamilos', 'sessions');
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  createSession(prompt: string, mode: string, strategy: string): RecordedSession {
    this.currentSession = {
      id: `session_${Date.now()}`,
      timestamp: Date.now(),
      prompt,
      mode,
      strategy,
      detectedAgents: [],
      selectedAgents: [],
      fallbacks: [],
      subtasks: [],
      terminalOutput: [],
      fileChanges: [],
      validationResults: [],
      approvalDecisions: [],
      finalResult: {
        success: false,
        durationMs: 0,
        errors: [],
      },
    };
    return this.currentSession;
  }

  getSession(): RecordedSession | null {
    return this.currentSession;
  }

  recordAgentDetected(agentId: string): void {
    if (this.currentSession && !this.currentSession.detectedAgents.includes(agentId)) {
      this.currentSession.detectedAgents.push(agentId);
    }
  }

  recordAgentSelected(agentId: string): void {
    if (this.currentSession && !this.currentSession.selectedAgents.includes(agentId)) {
      this.currentSession.selectedAgents.push(agentId);
    }
  }

  recordFallback(from: string, to: string): void {
    if (this.currentSession) {
      this.currentSession.fallbacks.push(`${from}->${to}`);
    }
  }

  recordSubtask(subtask: string): void {
    if (this.currentSession) {
      this.currentSession.subtasks.push(subtask);
    }
  }

  recordTerminalOutput(agentId: string, output: string): void {
    if (this.currentSession) {
      this.currentSession.terminalOutput.push(`[${agentId}] ${output}`);
    }
  }

  recordFileChange(path: string, action: string, hash?: string): void {
    if (this.currentSession) {
      this.currentSession.fileChanges.push({ path, action, hash });
    }
  }

  recordValidation(path: string, valid: boolean, errors: string[]): void {
    if (this.currentSession) {
      this.currentSession.validationResults.push({ path, valid, errors });
    }
  }

  recordApproval(action: string, approved: boolean, reason: string): void {
    if (this.currentSession) {
      this.currentSession.approvalDecisions.push({ action, approved, reason });
    }
  }

  recordResult(success: boolean, agentUsed?: string, durationMs?: number, errors?: string[]): void {
    if (this.currentSession) {
      this.currentSession.finalResult = {
        success,
        agentUsed,
        durationMs: durationMs || 0,
        errors: errors || [],
      };
    }
  }

  async save(): Promise<void> {
    if (!this.currentSession) return;
    const filePath = join(this.baseDir, `${this.currentSession.id}.json`);
    writeFileSync(filePath, JSON.stringify(this.currentSession, null, 2), 'utf-8');
  }

  getHistory(limit?: number): RecordedSession[] {
    if (!existsSync(this.baseDir)) return [];
    const files = readdirSync(this.baseDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    const selected = limit ? files.slice(0, limit) : files;
    return selected.map(f => {
      try {
        return JSON.parse(readFileSync(join(this.baseDir, f), 'utf-8')) as RecordedSession;
      } catch {
        return null;
      }
    }).filter(Boolean) as RecordedSession[];
  }

  getSessionById(id: string): RecordedSession | null {
    const filePath = join(this.baseDir, `${id}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as RecordedSession;
    } catch {
      return null;
    }
  }
}

let globalStore: SessionStore | null = null;

export function getSessionStore(): SessionStore {
  if (!globalStore) {
    globalStore = new SessionStore();
  }
  return globalStore;
}
