import { writeFileSync, mkdirSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import type { FileChange } from './ChangeCollector.js';

export interface ApplyResult {
  success: boolean;
  applied: string[];
  failed: { path: string; error: string }[];
}

export function applyChanges(changes: FileChange[], targetDir: string): ApplyResult {
  const applied: string[] = [];
  const failed: { path: string; error: string }[] = [];

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
          writeFileSync(fullPath, change.content || '', 'utf-8');
          applied.push(change.path);
          break;
        }
        case 'deleted': {
          if (existsSync(fullPath)) {
            unlinkSync(fullPath);
            applied.push(change.path);
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
