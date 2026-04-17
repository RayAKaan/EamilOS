import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { ClassifiedError, FileResult, PartialSuccessResult } from './stateful-types.js';
import { DELConfig, SafePath } from './types.js';

export interface FileWriteIntent {
  path: SafePath;
  content: string;
  expectedHash?: string;
}

export interface FileWriteResult {
  path: string;
  success: boolean;
  hash?: string;
  bytesWritten?: number;
  error?: string;
}

export interface ValidatedFile {
  path: string;
  content: string;
  hash: string;
}

export interface WritableFile extends FileResult {
  content: string;
}

export function isolateResults(
  files: ValidatedFile[],
  errors: ClassifiedError[]
): { valid: FileResult[]; failed: FileResult[] } {
  const errorMap = new Map<string, ClassifiedError>();

  for (const error of errors) {
    if (error.filePath) {
      const existing = errorMap.get(error.filePath);
      if (!existing || !existing.retryable) {
        errorMap.set(error.filePath, error);
      }
    }
  }

  const valid: FileResult[] = [];
  const failed: FileResult[] = [];

  for (const file of files) {
    const error = errorMap.get(file.path);

    if (error) {
      failed.push({
        path: file.path,
        status: 'failed',
        error,
      });
    } else {
      valid.push({
        path: file.path,
        status: 'pending',
        hash: file.hash,
        validatedAt: Date.now(),
      });
    }
  }

  return { valid, failed };
}

export async function writeFilesIndividually(
  files: WritableFile[],
  workspaceRoot: string,
  config: DELConfig,
  onFileSuccess?: (file: FileResult) => void,
  onFileFailure?: (file: FileResult) => void
): Promise<PartialSuccessResult> {
  const validFiles: FileResult[] = [];
  const failedFiles: FileResult[] = [];
  let totalBytesWritten = 0;

  for (const file of files) {
    file.status = 'writing';

    try {
      const resolvedPath = join(workspaceRoot, file.path);
      const dir = dirname(resolvedPath);

      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const size = Buffer.byteLength(file.content || '', 'utf-8');

      if (size > config.maxFileSizeBytes) {
        throw new Error(`File exceeds max size: ${size} > ${config.maxFileSizeBytes}`);
      }

      if (existsSync(resolvedPath) && file.hash) {
        try {
          const existingContent = readFileSync(resolvedPath, 'utf-8');
          const existingHash = createHash('sha256').update(existingContent, 'utf-8').digest('hex');
          if (existingHash === file.hash) {
            const skippedFile: FileResult = {
              path: file.path,
              status: 'skipped',
              hash: file.hash,
              writtenAt: Date.now(),
            };
            validFiles.push(skippedFile);
            onFileSuccess?.(skippedFile);
            continue;
          }
        } catch {
        }
      }

      const tmpPath = resolvedPath + '.tmp';
      writeFileSync(tmpPath, file.content || '', 'utf-8');

      try {
        if (existsSync(resolvedPath)) {
          rmSync(resolvedPath);
        }

        copyFileSync(tmpPath, resolvedPath);

        const writtenFile: FileResult = {
          path: file.path,
          status: 'success',
          hash: file.hash,
          bytesWritten: size,
          writtenAt: Date.now(),
        };

        totalBytesWritten += size;
        validFiles.push(writtenFile);
        onFileSuccess?.(writtenFile);
      } finally {
        if (existsSync(tmpPath)) {
          rmSync(tmpPath);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedFile: FileResult = {
        path: file.path,
        status: 'failed',
        error: {
          ...file.error!,
          message: `Write failed: ${errorMessage}`,
          suggestedStrategy: 'Check file permissions and disk space.',
        },
      };
      failedFiles.push(failedFile);
      onFileFailure?.(failedFile);
    }
  }

  return {
    validFiles,
    failedFiles,
    totalBytesWritten,
    allSucceeded: failedFiles.length === 0,
  };
}

export function markFileAsSkipped(file: FileResult, reason: string): FileResult {
  return {
    ...file,
    status: 'skipped',
    error: {
      ...file.error!,
      message: `Skipped: ${reason}`,
      suggestedStrategy: 'File unchanged, no write needed.',
    },
  };
}

export function mergeFileResults(existing: FileResult[], incoming: FileResult[]): FileResult[] {
  const resultMap = new Map<string, FileResult>();

  for (const file of existing) {
    resultMap.set(file.path, file);
  }

  for (const file of incoming) {
    const existingFile = resultMap.get(file.path);

    if (!existingFile) {
      resultMap.set(file.path, file);
      continue;
    }

    if (file.status === 'success' && existingFile.status !== 'failed') {
      resultMap.set(file.path, file);
    } else if (file.status === 'failed' && existingFile.status === 'success') {
    } else {
      resultMap.set(file.path, file);
    }
  }

  return Array.from(resultMap.values());
}

export function getSuccessfulFiles(files: FileResult[]): FileResult[] {
  return files.filter(f => f.status === 'success');
}

export function getFailedFiles(files: FileResult[]): FileResult[] {
  return files.filter(f => f.status === 'failed');
}

export function getPendingFiles(files: FileResult[]): FileResult[] {
  return files.filter(f => f.status === 'pending');
}

export function calculateProgress(files: FileResult[]): { total: number; completed: number; failed: number; pending: number } {
  return {
    total: files.length,
    completed: files.filter(f => f.status === 'success').length,
    failed: files.filter(f => f.status === 'failed').length,
    pending: files.filter(f => f.status === 'pending' || f.status === 'writing').length,
  };
}
