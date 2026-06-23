import { Result, ok, err, ExtractedPayload, ExtractedFile, DELValidationError, DELErrorCode } from './types.js';

export type ExtractionStrategy = 
  | 'markdown-block'
  | 'brace-substring'
  | 'array-rescue'
  | 'line-by-line-greedy'
  | 'none';

function preprocess(raw: string): string {
  let result = raw;

  result = result.replace(/^\uFEFF/, '');
  result = result.replace(/^\uFFFE/, '');

  result = result.trim();

  result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  result = result
    .replace(/^[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/, '');

  return result;
}

function attemptLightRepair(json: string): string | null {
  let attempt = json;

  attempt = attempt.replace(/,\s*([}\]])/g, '$1');

  try {
    JSON.parse(attempt);
    return attempt;
  } catch {
  }

  attempt = attempt.replace(/\/\/[^\n]*/g, '');

  try {
    JSON.parse(attempt);
    return attempt;
  } catch {
  }

  if (!attempt.includes("\\'") && !attempt.includes("it's") && !attempt.includes("don't")) {
    const singleQuoteAttempt = attempt.replace(/'/g, '"');
    try {
      JSON.parse(singleQuoteAttempt);
      return singleQuoteAttempt;
    } catch {
    }
  }

  return null;
}

function strategy1MarkdownBlock(input: string): { json: string | null; strategy: ExtractionStrategy } {
  const jsonBlockMatch = input.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlockMatch) {
    const candidate = jsonBlockMatch[1].trim();
    try {
      JSON.parse(candidate);
      return { json: candidate, strategy: 'markdown-block' };
    } catch {
      const repaired = attemptLightRepair(candidate);
      if (repaired) {
        try {
          JSON.parse(repaired);
          return { json: repaired, strategy: 'markdown-block' };
        } catch {
        }
      }
    }
  }

  return { json: null, strategy: 'markdown-block' };
}

function strategy2BraceSubstring(input: string): { json: string | null; strategy: ExtractionStrategy } {
  const firstBrace = input.indexOf('{');
  const lastBrace = input.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = input.substring(firstBrace, lastBrace + 1);
    try {
      JSON.parse(candidate);
      return { json: candidate, strategy: 'brace-substring' };
    } catch {
      const repaired = attemptLightRepair(candidate);
      if (repaired) {
        try {
          JSON.parse(repaired);
          return { json: repaired, strategy: 'brace-substring' };
        } catch {
        }
      }
    }
  }

  return { json: null, strategy: 'brace-substring' };
}

function strategy3ArrayRescue(input: string): { json: string | null; strategy: ExtractionStrategy } {
  const firstBracket = input.indexOf('[');
  const lastBracket = input.lastIndexOf(']');

  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const candidate = input.substring(firstBracket, lastBracket + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return { json: candidate, strategy: 'array-rescue' };
      }
    } catch {
      const repaired = attemptLightRepair(candidate);
      if (repaired) {
        try {
          const parsed = JSON.parse(repaired);
          if (Array.isArray(parsed)) {
            return { json: repaired, strategy: 'array-rescue' };
          }
        } catch {
        }
      }
    }
  }

  return { json: null, strategy: 'array-rescue' };
}

interface ParsedFile {
  path: string;
  content: string;
}

function parseLineByLineGreedy(input: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const lines = input.split('\n');
  let currentPath: string | null = null;
  let currentContent: string[] = [];

  const pathPattern = /^(?:\/\/|#|<!--)\s*(?:File|File:)\s*(.+?)\s*$/i;

  for (const line of lines) {
    const trimmed = line.trim();

    const pathMatch = trimmed.match(pathPattern);
    if (pathMatch) {
      if (currentPath && currentContent.length > 0) {
        const content = currentContent.join('\n');
        if (content.length > 5) {
          files.push({ path: currentPath, content });
        }
      }
      currentPath = pathMatch[1].trim();
      currentContent = [];
      continue;
    }

    if (trimmed.startsWith('```')) {
      if (currentContent.length > 0) {
        const content = currentContent.join('\n');
        if (content.length > 5) {
          files.push({ path: currentPath || `file-${files.length}.txt`, content });
        }
        currentContent = [];
        currentPath = null;
      } else {
        continue;
      }
    }

    if (currentPath) {
      currentContent.push(line);
    }
  }

  if (currentPath && currentContent.length > 0) {
    const content = currentContent.join('\n');
    if (content.length > 5) {
      files.push({ path: currentPath, content });
    }
  }

  return files;
}

function strategy4LineByLineGreedy(input: string): { files: ExtractedFile[]; strategy: ExtractionStrategy } {
  const parsed = parseLineByLineGreedy(input);

  if (parsed.length === 0) {
    return { files: [], strategy: 'line-by-line-greedy' };
  }

  return {
    files: parsed.map(f => ({ path: f.path, content: f.content })),
    strategy: 'line-by-line-greedy',
  };
}

export function extract(rawText: string): Result<ExtractedPayload, DELValidationError> {
  const cleaned = preprocess(rawText);

  const mdBlock = strategy1MarkdownBlock(cleaned);
  if (mdBlock.json) {
    try {
      const parsed = JSON.parse(mdBlock.json);
      if (typeof parsed === 'object' && parsed !== null && 'files' in parsed) {
        const payload = parsed as { files: Array<{ path?: unknown; content?: unknown }> };
        if (Array.isArray(payload.files)) {
          const extractedFiles: ExtractedFile[] = payload.files
            .filter((f): f is { path: string; content: string } =>
              typeof f.path === 'string' && typeof f.content === 'string'
            )
            .map(f => ({ path: f.path.trim(), content: f.content }));

          if (extractedFiles.length > 0) {
            return ok({
              files: extractedFiles,
              extractionStrategy: mdBlock.strategy,
            });
          }
        }
      }
    } catch {
    }
  }

  const braceSubstr = strategy2BraceSubstring(cleaned);
  if (braceSubstr.json) {
    try {
      const parsed = JSON.parse(braceSubstr.json);
      if (typeof parsed === 'object' && parsed !== null && 'files' in parsed) {
        const payload = parsed as { files: Array<{ path?: unknown; content?: unknown }> };
        if (Array.isArray(payload.files)) {
          const extractedFiles: ExtractedFile[] = payload.files
            .filter((f): f is { path: string; content: string } =>
              typeof f.path === 'string' && typeof f.content === 'string'
            )
            .map(f => ({ path: f.path.trim(), content: f.content }));

          if (extractedFiles.length > 0) {
            return ok({
              files: extractedFiles,
              extractionStrategy: braceSubstr.strategy,
            });
          }
        }
      }
    } catch {
    }
  }

  const arrayRescue = strategy3ArrayRescue(cleaned);
  if (arrayRescue.json) {
    try {
      const parsed = JSON.parse(arrayRescue.json);
      if (Array.isArray(parsed)) {
        const extractedFiles: ExtractedFile[] = parsed
          .filter((f): f is { path: string; content: string } =>
            typeof f === 'object' && f !== null &&
            typeof f.path === 'string' && typeof f.content === 'string'
          )
          .map(f => ({ path: f.path.trim(), content: f.content }));

        if (extractedFiles.length > 0) {
          return ok({
            files: extractedFiles,
            extractionStrategy: arrayRescue.strategy,
          });
        }
      }
    } catch {
    }
  }

  const lineByLine = strategy4LineByLineGreedy(cleaned);
  if (lineByLine.files.length > 0) {
    return ok({
      files: lineByLine.files,
      extractionStrategy: lineByLine.strategy,
    });
  }

  return err({
    code: DELErrorCode.EXTRACTION_FAILURE,
    message: 'Failed to extract JSON payload from model output',
    context: cleaned.substring(0, 200),
    stage: 'extraction',
  });
}

export function getExtractionStrategyName(strategy: ExtractionStrategy): string {
  const names: Record<ExtractionStrategy, string> = {
    'markdown-block': 'Markdown Code Block',
    'brace-substring': 'Brace Substring',
    'array-rescue': 'Array Rescue',
    'line-by-line-greedy': 'Line-by-Line Greedy',
    'none': 'None',
  };
  return names[strategy];
}
