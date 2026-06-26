import { writeFileSync, mkdirSync, unlinkSync, existsSync, readFileSync, renameSync, openSync, closeSync, fstatSync, fsyncSync } from 'fs';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import { getSessionStore } from '../session/SessionStore.js';
import type { FileChange } from './ChangeCollector.js';

export interface ApplyResult {
  success: boolean;
  applied: string[];
  failed: { path: string; error: string }[];
}

function verifyFileHash(fullPath: string, expectedContent: string): boolean {
  try {
    const actual = readFileSync(fullPath, 'utf-8');
    const actualHash = createHash('sha256').update(actual).digest('hex');
    const expectedHash = createHash('sha256').update(expectedContent).digest('hex');
    return actualHash === expectedHash;
  } catch {
    return false;
  }
}

function atomicWrite(targetPath: string, content: string): void {
  const tmpPath = targetPath + '.tmp.' + Date.now();
  writeFileSync(tmpPath, content, 'utf-8');
  const fd = openSync(tmpPath, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, targetPath);
}

export function applyChanges(changes: FileChange[], targetDir: string): ApplyResult {
  const applied: string[] = [];
  const failed: { path: string; error: string }[] = [];
  const store = getSessionStore();

  for (const change of changes) {
    const fullPath = join(targetDir, change.path);

    try {
      switch (change.action) {
        case 'created':
        case 'modified': {
          const dir = dirname(fullPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          atomicWrite(fullPath, change.content || '');
          if (!verifyFileHash(fullPath, change.content || '')) {
            throw new Error('File hash verification failed after write');
          }
          applied.push(change.path);
          store.recordFileChange(change.path, change.action, createHash('sha256').update(change.content || '').digest('hex'));
          break;
        }
        case 'deleted': {
          if (existsSync(fullPath)) {
            const beforeHash = createHash('sha256').update(readFileSync(fullPath)).digest('hex');
            unlinkSync(fullPath);
            applied.push(change.path);
            store.recordFileChange(change.path, 'deleted', beforeHash);
          }
          break;
        }
      }
    } catch (err) {
      failed.push({ path: change.path, error: (err as Error).message });
    }
  }

  return { success: failed.length === 0, applied, failed };
}
