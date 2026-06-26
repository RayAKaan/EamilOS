import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, sep } from 'path';
import { createHash } from 'crypto';

export interface FileSnapshot {
  path: string;
  hash: string;
  size: number;
  mtimeMs: number;
}

export interface FileChange {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  beforeHash?: string;
  afterHash?: string;
  content?: string;
  diff?: string;
  agentId: string;
}

function hashFile(filePath: string): string {
  try {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return '';
  }
}

function walkDir(dir: string, baseDir: string): FileSnapshot[] {
  const snapshots: FileSnapshot[] = [];
  if (!existsSync(dir)) return snapshots;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      try {
        if (entry.isDirectory()) {
          snapshots.push(...walkDir(fullPath, baseDir));
        } else if (entry.isFile()) {
          const relPath = relative(baseDir, fullPath);
          const stats = statSync(fullPath);
          snapshots.push({
            path: relPath,
            hash: hashFile(fullPath),
            size: stats.size,
            mtimeMs: stats.mtimeMs,
          });
        }
      } catch { }
    }
  } catch { }

  return snapshots;
}

export function takeWorkspaceSnapshot(dir: string): Map<string, FileSnapshot> {
  const snapshot = new Map<string, FileSnapshot>();
  const files = walkDir(dir, dir);
  for (const f of files) {
    snapshot.set(f.path, f);
  }
  return snapshot;
}

export function diffWorkspace(
  before: Map<string, FileSnapshot>,
  after: Map<string, FileSnapshot>,
  workspaceDir: string,
  agentId: string
): FileChange[] {
  const changes: FileChange[] = [];

  for (const [path, afterFile] of after) {
    const beforeFile = before.get(path);
    if (!beforeFile) {
      const fullPath = join(workspaceDir, path);
      changes.push({
        path,
        action: 'created',
        afterHash: afterFile.hash,
        content: existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : undefined,
        agentId,
      });
    } else if (beforeFile.hash !== afterFile.hash) {
      const fullPath = join(workspaceDir, path);
      changes.push({
        path,
        action: 'modified',
        beforeHash: beforeFile.hash,
        afterHash: afterFile.hash,
        content: existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : undefined,
        agentId,
      });
    }
  }

  for (const [path, beforeFile] of before) {
    if (!after.has(path)) {
      changes.push({
        path,
        action: 'deleted',
        beforeHash: beforeFile.hash,
        agentId,
      });
    }
  }

  return changes;
}
