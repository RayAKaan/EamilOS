import { ParsedFile } from '../parsers/ResponseParser.js';
import { PathValidator } from '../security/index.js';

export interface ValidationError {
  path: string;
  reason: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  validFiles: ParsedFile[];
  rejectedFiles: Array<{ path: string; reason: string }>;
}

const INVALID_CHARS = /[<>"|?*\x00-\x1F]/;

const DESCRIPTION_PATTERNS = [
  /^This (file|is|will)/i,
  /^Here (is|are)/i,
  /^The following/i,
  /^I will/i,
  /^Create a/i,
  /^Below is/i,
  /^This is a/i,
  /^A (simple|basic|bare)/i,
  /^Example:/i,
];

function isDescriptionContent(content: string): boolean {
  const trimmed = content.trim();
  return DESCRIPTION_PATTERNS.some(pattern => pattern.test(trimmed));
}

function hasValidExtension(path: string): boolean {
  const parts = path.split('.');
  return parts.length >= 2 && parts[parts.length - 1].length > 0;
}

export function validate(files: ParsedFile[]): ValidationResult {
  const errors: ValidationError[] = [];
  const validFiles: ParsedFile[] = [];
  const rejectedFiles: Array<{ path: string; reason: string }> = [];

  for (const file of files) {
    const path = file.path.trim();
    
    if (!path) {
      rejectedFiles.push({ path: file.path, reason: 'EMPTY_PATH' });
      errors.push({ path: file.path, reason: 'Path is empty' });
      continue;
    }
    
    const blockCheck = PathValidator.isBlockedFilename(path);
    if (blockCheck.blocked) {
      rejectedFiles.push({ path, reason: 'BLOCKED_FILENAME' });
      errors.push({ path, reason: blockCheck.reason });
      continue;
    }
    
    if (!hasValidExtension(path)) {
      rejectedFiles.push({ path, reason: 'NO_EXTENSION' });
      errors.push({ path, reason: 'Path has no file extension' });
      continue;
    }
    
    if (INVALID_CHARS.test(path)) {
      rejectedFiles.push({ path, reason: 'INVALID_CHARS' });
      errors.push({ path, reason: 'Path contains invalid characters' });
      continue;
    }
    
    if (typeof file.content !== 'string') {
      rejectedFiles.push({ path, reason: 'NO_CONTENT' });
      errors.push({ path, reason: 'Content is missing or not a string' });
      continue;
    }
    
    const content = file.content.trim();
    
    if (content.length < 5 && !path.endsWith('.txt')) {
      rejectedFiles.push({ path, reason: 'CONTENT_TOO_SHORT' });
      errors.push({ path, reason: 'Content is shorter than 5 characters' });
      continue;
    }
    
    if (isDescriptionContent(content)) {
      rejectedFiles.push({ path, reason: 'DESCRIPTION_INSTEAD_OF_CODE' });
      errors.push({ path, reason: 'Content appears to be a description, not actual file content' });
      continue;
    }
    
    validFiles.push({
      ...file,
      path,
      content: file.content,
    });
  }

  return {
    valid: validFiles.length > 0,
    errors,
    validFiles,
    rejectedFiles,
  };
}
