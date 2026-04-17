import { createHash } from 'crypto';
import { writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { SafePath, brandValidatedCode, GuaranteedFile, ExecutionReceipt, DELValidationError, DELConfig } from './types.js';

export interface AtomicWriteResult {
  success: boolean;
  receipt: ExecutionReceipt;
  errors: string[];
}

function computeSHA256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

export function writeAtomically(
  files: Array<{ path: SafePath; content: string }>,
  workspaceRoot: string,
  config: DELConfig
): AtomicWriteResult {
  const startTime = Date.now();
  const errors: string[] = [];
  const writtenFiles: GuaranteedFile[] = [];
  let bytesWritten = 0;

  for (const file of files) {
    const safePath = file.path;
    const content = file.content;
    const resolvedPath = join(workspaceRoot, safePath);

    try {
      const size = Buffer.byteLength(content, 'utf-8');

      if (size > config.maxFileSizeBytes) {
        errors.push(`File exceeds max size: ${safePath} (${size} > ${config.maxFileSizeBytes})`);
        continue;
      }

      const dir = dirname(resolvedPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const tmpPath = resolvedPath + '.tmp';
      writeFileSync(tmpPath, content, 'utf-8');

      try {
        if (existsSync(resolvedPath)) {
          rmSync(resolvedPath);
        }
        copyFileSync(tmpPath, resolvedPath);

        const hash = computeSHA256(content);
        bytesWritten += size;

        writtenFiles.push({
          path: safePath,
          content: brandValidatedCode(content),
          hash,
        });
      } finally {
        if (existsSync(tmpPath)) {
          rmSync(tmpPath);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to write ${safePath}: ${message}`);
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    success: errors.length === 0 && writtenFiles.length > 0,
    receipt: {
      success: errors.length === 0 && writtenFiles.length > 0,
      filesWritten: writtenFiles,
      bytesWritten,
      durationMs,
      errors: [],
      extractionStrategy: '',
      attemptCount: 1,
    },
    errors,
  };
}

export function verifyFileIntegrity(
  file: { path: string; content: string },
  expectedHash?: string
): { valid: boolean; actualHash?: string; expectedHash?: string } {
  const actualHash = computeSHA256(file.content);

  if (expectedHash) {
    return {
      valid: actualHash === expectedHash,
      actualHash,
      expectedHash,
    };
  }

  return {
    valid: true,
    actualHash,
  };
}

export function getFileSize(path: string): number {
  try {
    const stat = statSync(path);
    return stat.size;
  } catch {
    return 0;
  }
}

export function createExecutionReceipt(
  success: boolean,
  files: GuaranteedFile[],
  bytesWritten: number,
  durationMs: number,
  errors: DELValidationError[],
  extractionStrategy: string,
  attemptCount: number
): ExecutionReceipt {
  return {
    success,
    filesWritten: files,
    bytesWritten,
    durationMs,
    errors,
    extractionStrategy,
    attemptCount,
  };
}
