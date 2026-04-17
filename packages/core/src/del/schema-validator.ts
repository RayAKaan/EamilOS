import { z } from 'zod';
import { Result, ok, err, ExtractedPayload, ExtractedFile, DELValidationError, DELErrorCode, DELConfig } from './types.js';

const FileSchema = z.object({
  path: z.string().min(1, 'Path cannot be empty'),
  content: z.string().min(1, 'Content cannot be empty'),
});

const ExtractedPayloadSchema = z.object({
  files: z.array(FileSchema).min(1, 'At least one file is required'),
});

export interface SchemaValidationResult {
  valid: boolean;
  errors: DELValidationError[];
  validFiles: ExtractedFile[];
  rejectedFiles: Array<{ path: string; reason: string }>;
}

function hasValidExtension(path: string): boolean {
  const parts = path.split('.');
  return parts.length >= 2 && parts[parts.length - 1].length > 0;
}

function getExtension(path: string): string {
  const parts = path.split('.');
  return parts.length >= 2 ? parts[parts.length - 1].toLowerCase() : '';
}

const ALLOWED_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'pyw',
  'java', 'kt', 'kts',
  'cs', 'fs', 'fsx',
  'cpp', 'cc', 'cxx', 'c', 'h', 'hpp',
  'go',
  'rs',
  'rb',
  'php',
  'swift',
  'html', 'htm',
  'css', 'scss', 'sass', 'less',
  'json', 'jsonc',
  'yaml', 'yml',
  'xml',
  'md', 'mdx',
  'txt',
  'sh', 'bash', 'zsh',
  'sql',
  'dockerfile',
  'toml', 'ini', 'cfg', 'conf',
  'env',
  'gitignore', 'gitattributes', 'gitkeep',
  'svg', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp',
  'pdf',
  'zip', 'tar', 'gz', 'rar',
  'exe', 'dll', 'so', 'dylib',
]);

export function validateSchema(
  payload: ExtractedPayload,
  config: DELConfig
): Result<SchemaValidationResult, DELValidationError> {
  const errors: DELValidationError[] = [];
  const validFiles: ExtractedFile[] = [];
  const rejectedFiles: Array<{ path: string; reason: string }> = [];

  const parseResult = ExtractedPayloadSchema.safeParse(payload);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      errors.push({
        code: DELErrorCode.SCHEMA_MISMATCH,
        message: `Schema validation failed: ${issue.message}`,
        context: JSON.stringify(issue),
        stage: 'schema',
      });
    }

    return err({
      code: DELErrorCode.SCHEMA_MISMATCH,
      message: `Schema validation failed: ${parseResult.error.issues.map(i => i.message).join(', ')}`,
      context: JSON.stringify(parseResult.error.issues),
      stage: 'schema',
    });
  }

  for (const file of payload.files) {
    const path = file.path.trim();
    const content = file.content.trim();

    if (!path) {
      rejectedFiles.push({ path: file.path, reason: 'EMPTY_PATH' });
      errors.push({
        code: DELErrorCode.SCHEMA_MISMATCH,
        message: 'Path is empty',
        context: path,
        stage: 'schema',
      });
      continue;
    }

    if (!hasValidExtension(path)) {
      rejectedFiles.push({ path, reason: 'NO_EXTENSION' });
      errors.push({
        code: DELErrorCode.SCHEMA_MISMATCH,
        message: 'Path has no file extension',
        context: path,
        stage: 'schema',
      });
      continue;
    }

    const ext = getExtension(path);
    if (!ALLOWED_EXTENSIONS.has(ext) && !config.strictMode) {
      rejectedFiles.push({ path, reason: 'UNRECOGNIZED_EXTENSION' });
      errors.push({
        code: DELErrorCode.SCHEMA_MISMATCH,
        message: `Unrecognized file extension: .${ext}`,
        context: path,
        stage: 'schema',
      });
      continue;
    }

    if (!content) {
      rejectedFiles.push({ path, reason: 'EMPTY_CONTENT' });
      errors.push({
        code: DELErrorCode.SCHEMA_MISMATCH,
        message: 'Content is empty',
        context: path,
        stage: 'schema',
      });
      continue;
    }

    if (content.length > config.maxFileSizeBytes) {
      rejectedFiles.push({ path, reason: 'CONTENT_TOO_LARGE' });
      errors.push({
        code: DELErrorCode.SCHEMA_MISMATCH,
        message: `Content exceeds maximum size (${config.maxFileSizeBytes} bytes)`,
        context: path,
        stage: 'schema',
      });
      continue;
    }

    validFiles.push({ path, content });
  }

  if (validFiles.length === 0) {
    return err({
      code: DELErrorCode.SCHEMA_MISMATCH,
      message: 'No valid files found after schema validation',
      context: `Rejected: ${rejectedFiles.map(r => `${r.path} (${r.reason})`).join(', ')}`,
      stage: 'schema',
      filePath: rejectedFiles[0]?.path,
    });
  }

  return ok({
    valid: true,
    errors,
    validFiles,
    rejectedFiles,
  });
}

export function validateStrictMode(
  payload: ExtractedPayload,
  allowedKeys: string[]
): Result<void, DELValidationError> {
  const payloadKeys = Object.keys(payload);
  const extraKeys = payloadKeys.filter(k => k !== 'files' && !allowedKeys.includes(k));

  if (extraKeys.length > 0) {
    return err({
      code: DELErrorCode.SCHEMA_MISMATCH,
      message: `Strict mode: unexpected keys found: ${extraKeys.join(', ')}`,
      context: extraKeys.join(', '),
      stage: 'schema',
    });
  }

  return ok(undefined);
}
