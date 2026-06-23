// PHASE 2: Full implementation - project-scoped memory
import { nanoid } from 'nanoid';
import { getDatabase } from './db.js';
import { getLogger } from './logger.js';

export type MemoryType = 'fact' | 'preference' | 'decision' | 'mistake' | 'procedure';

export interface MemoryEntry {
  id: string;
  projectId: string;
  type: MemoryType;
  key: string;
  content: string;
  importance: number;
  createdAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
}

export interface MemoryRecallResult {
  entries: MemoryEntry[];
  scores: Map<string, number>;
}

export class Memory {
  private cache: Map<string, MemoryEntry[]> = new Map();
  private recallCache: Map<string, { entries: MemoryEntry[]; timestamp: number }> = new Map();
  private cacheExpiry = 60000;

  async store(
    projectId: string,
    type: MemoryType,
    key: string,
    content: string,
    importance: number = 5
  ): Promise<MemoryEntry> {
    const db = getDatabase();

    const entry: MemoryEntry = {
      id: nanoid(8),
      projectId,
      type,
      key,
      content,
      importance,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      accessCount: 0,
    };

    this.cache.delete(projectId);

    try {
      db.createMemoryEntry?.(entry);
    } catch {
      getLogger().debug('Memory entry not persisted to database');
    }

    return entry;
  }

  async recall(projectId: string, query: string): Promise<MemoryRecallResult> {
    const cacheKey = `${projectId}:${query}`;

    const cached = this.recallCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return { entries: cached.entries, scores: new Map() };
    }

    const entries = await this.loadEntries(projectId);
    const queryLower = query.toLowerCase();

    const scored = entries
      .map((entry) => {
        let score = 0;

        if (entry.content.toLowerCase().includes(queryLower)) {
          score += 10;
        }
        if (entry.key.toLowerCase().includes(queryLower)) {
          score += 5;
        }

        score += entry.importance;
        score += Math.log(entry.accessCount + 1);

        const age = Date.now() - entry.createdAt.getTime();
        const daysOld = age / (1000 * 60 * 60 * 24);
        score *= Math.max(0.5, 1 - daysOld * 0.01);

        return { entry, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    const resultEntries = scored.map(({ entry }) => entry);
    const scores = new Map(scored.map(({ entry, score }) => [entry.id, score]));

    this.recallCache.set(cacheKey, { entries: resultEntries, timestamp: Date.now() });

    for (const entry of resultEntries) {
      entry.accessCount++;
      entry.lastAccessedAt = new Date();
    }

    return { entries: resultEntries, scores };
  }

  async get(projectId: string, key: string): Promise<MemoryEntry | null> {
    const entries = await this.loadEntries(projectId);
    return entries.find((e) => e.key === key) ?? null;
  }

  async getByType(projectId: string, type: MemoryType): Promise<MemoryEntry[]> {
    const entries = await this.loadEntries(projectId);
    return entries.filter((e) => e.type === type);
  }

  async forget(projectId: string, entryId: string): Promise<void> {
    this.cache.delete(projectId);
    const db = getDatabase();
    try {
      db.deleteMemoryEntry?.(entryId);
    } catch {
      getLogger().debug('Memory entry not deleted from database');
    }
    void projectId;
  }

  async clear(projectId: string): Promise<void> {
    this.cache.delete(projectId);
    const db = getDatabase();
    try {
      db.clearMemoryEntries?.(projectId);
    } catch {
      getLogger().debug('Memory entries not cleared from database');
    }
  }

  private async loadEntries(projectId: string): Promise<MemoryEntry[]> {
    const cached = this.cache.get(projectId);
    if (cached) {
      return cached;
    }

    const db = getDatabase();
    let entries: MemoryEntry[] = [];

    try {
      entries = (db.getMemoryEntries?.(projectId) ?? []) as MemoryEntry[];
    } catch {
      entries = [];
    }

    this.cache.set(projectId, entries);
    return entries;
  }
}

let globalMemory: Memory | null = null;

export function initMemory(): Memory {
  globalMemory = new Memory();
  return globalMemory;
}

export function getMemory(): Memory {
  if (!globalMemory) {
    return initMemory();
  }
  return globalMemory;
}
