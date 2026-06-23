export interface ParsedFile {
  path: string;
  content: string;
  language?: string;
}

export type ExtractionMethod = 'DIRECT_PARSE' | 'CODE_BLOCK' | 'BRACE_EXTRACTION' | 'BRACE_EXTRACTION_REPAIRED' | 'NESTED_SEARCH' | 'NONE';

export interface ParseResult {
  success: boolean;
  files: ParsedFile[];
  summary?: string;
  rawResponse: string;
  failureReason?: 'NO_JSON_FOUND' | 'INVALID_JSON' | 'NO_FILES_ARRAY' | 'NO_VALID_FILES' | 'INVALID_STRUCTURE' | 'CONTENT_REJECTED';
  extractionMethod: ExtractionMethod;
}

const BLOCKED_FILENAMES: Set<string> = new Set([
  "data.json",
  "output.txt",
  "file.txt",
  "untitled",
  "response.json",
  "result.json",
  "output.json",
  "temp.txt",
  "example.txt",
  "test.txt",
  "sample.txt",
  "demo.txt",

  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.staging",
  ".env.test",

  "id_rsa",
  "id_rsa.pub",
  "id_ed25519",
  "id_ed25519.pub",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".pgpass",
  "credentials.json",
  "service-account.json",
  "keyfile.json",

  ".git",
  ".gitconfig",

  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "gemfile.lock",
  "composer.lock",

  ".ds_store",
  "thumbs.db",
  "desktop.ini",

  "node_modules",
]);

const BLOCKED_PATTERNS: RegExp[] = [
  /^\.env\b/i,
  /^\.git\b/i,
  /secret/i,
  /credential/i,
  /password/i,
  /private[_-]?key/i,
];

const ALLOWED_DESPITE_PATTERN: Set<string> = new Set([
  ".gitignore",
  ".gitattributes",
  ".gitkeep",
  ".github",
]);

const DESCRIPTION_PATTERNS = [
  /^(here's|here is|below is|this is|the following|following)[\s:]/i,
  /^(first|second|third|finally)[\s,]/i,
  /^step \d+[:\.]/i,
  /^to (do|complete|accomplish)/i,
  /^(note|tip|warning|important)[:\-]/i,
  /^(yes|no|ok|okay),?\s+(here|this|that|i'll|i will)/i,
  /^[\[\(]\d+[\]\)]\s*$/,
  /^#{1,3}\s+\w+/,
  /^(example|sample|template):/i,
];

function hasValidExtension(path: string): boolean {
  const parts = path.split('.');
  return parts.length >= 2 && parts[parts.length - 1].length > 0;
}

const CODE_KEYWORDS = new Set([
  'import', 'export', 'from', 'const', 'let', 'var', 'function',
  'class', 'interface', 'type', 'enum', 'return', 'if', 'else',
  'for', 'while', 'switch', 'case', 'break', 'continue', 'try',
  'catch', 'finally', 'throw', 'new', 'this', 'super', 'extends',
  'implements', 'public', 'private', 'protected', 'static', 'async',
  'await', 'def', 'async', 'print', 'fn', 'pub', 'struct', 'impl',
  'module', 'require', 'exports', 'def', 'lambda', 'yield', 'async',
]);

function looksLikeDescription(content: string): boolean {
  const trimmed = content.trim().toLowerCase();
  
  if (trimmed.length < 15) {
    const words = trimmed.split(/\s+/);
    if (words.some(w => CODE_KEYWORDS.has(w))) return false;
    if (/[{}\[\]();=<>]/.test(trimmed)) return false;
    return true;
  }
  
  const codeChars = (trimmed.match(/[{}\[\]();=:<>+\-*/&|]/g) || []).length;
  const codeRatio = codeChars / trimmed.length;
  
  if (codeRatio < 0.03) return true;
  
  for (const pattern of DESCRIPTION_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  
  return false;
}

function extractOutermostBraces(str: string): string | null {
  let braceCount = 0;
  let start = -1;
  let end = -1;
  
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '{') {
      if (braceCount === 0) start = i;
      braceCount++;
    } else if (str[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        end = i;
        return str.substring(start, end + 1);
      }
    }
  }
  
  return null;
}

function preprocess(raw: string): string {
  let result = raw;

  result = result.replace(/^\uFEFF/, "");
  result = result.replace(/^\uFFFE/, "");

  result = result.trim();

  result = result.replace(/^\0+/, "").replace(/\0+$/, "");

  result = result.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  result = result
    .replace(/^[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/, "")
    .replace(/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/, "");

  return result;
}

function attemptLightRepair(json: string): string | null {
  let attempt = json;

  attempt = attempt.replace(/,\s*([}\]])/g, "$1");

  try {
    JSON.parse(attempt);
    return attempt;
  } catch {
  }

  attempt = attempt.replace(/\/\/[^\n]*/g, "");

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

function isBlockedFilename(filePath: string): { blocked: boolean; reason: string } {
  const normalized = filePath.trim().toLowerCase();
  const basename = normalized.split("/").pop() || normalized;

  if (ALLOWED_DESPITE_PATTERN.has(basename)) {
    return { blocked: false, reason: "" };
  }

  if (BLOCKED_FILENAMES.has(basename)) {
    return {
      blocked: true,
      reason: "BLOCKED_FILENAME: '" + filePath + "' is not allowed " +
              "(matched blocked name '" + basename + "')"
    };
  }

  if (BLOCKED_FILENAMES.has(normalized)) {
    return {
      blocked: true,
      reason: "BLOCKED_PATH: '" + filePath + "' matches blocked path"
    };
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(basename) || pattern.test(normalized)) {
      return {
        blocked: true,
        reason: "BLOCKED_PATTERN: '" + filePath + "' matches security pattern " +
                pattern.toString()
      };
    }
  }

  return { blocked: false, reason: "" };
}

function stage1DirectParse(input: string): { json: string | null; method: ExtractionMethod } {
  const trimmed = input.trim();
  
  if (trimmed.startsWith('{')) {
    const result = extractOutermostBraces(trimmed);
    if (result) {
      try {
        JSON.parse(result);
        return { json: result, method: 'DIRECT_PARSE' };
      } catch {
        const repaired = attemptLightRepair(result);
        if (repaired) {
          try {
            JSON.parse(repaired);
            return { json: repaired, method: 'DIRECT_PARSE' };
          } catch {
          }
        }
        return { json: null, method: 'DIRECT_PARSE' };
      }
    }
  }
  
  return { json: null, method: 'DIRECT_PARSE' };
}

function stage2CodeBlock(input: string): { json: string | null; method: ExtractionMethod } {
  const jsonBlockMatch = input.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlockMatch) {
    const candidate = jsonBlockMatch[1].trim();
    try {
      JSON.parse(candidate);
      return { json: candidate, method: 'CODE_BLOCK' };
    } catch {
      const repaired = attemptLightRepair(candidate);
      if (repaired) {
        try {
          JSON.parse(repaired);
          return { json: repaired, method: 'CODE_BLOCK' };
        } catch {
        }
      }
      return { json: null, method: 'CODE_BLOCK' };
    }
  }
  
  return { json: null, method: 'CODE_BLOCK' };
}

function stage3BraceExtraction(input: string): { json: string | null; method: ExtractionMethod } {
  const firstBrace = input.indexOf('{');
  const lastBrace = input.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = input.substring(firstBrace, lastBrace + 1);
    try {
      JSON.parse(candidate);
      return { json: candidate, method: 'BRACE_EXTRACTION' };
    } catch {
      const repaired = attemptLightRepair(candidate);
      if (repaired) {
        try {
          JSON.parse(repaired);
          return { json: repaired, method: 'BRACE_EXTRACTION_REPAIRED' };
        } catch {
        }
      }
      return { json: null, method: 'BRACE_EXTRACTION' };
    }
  }
  
  return { json: null, method: 'BRACE_EXTRACTION' };
}

function stage4NestedSearch(input: string): { json: string | null; method: ExtractionMethod } {
  const lines = input.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('"files"') || lines[i].includes("'files'")) {
      let startIdx = i;
      while (startIdx >= 0 && !lines[startIdx].includes('{')) {
        startIdx--;
      }
      
      if (startIdx >= 0) {
        const remaining = lines.slice(startIdx).join('\n');
        const result = extractOutermostBraces(remaining);
        if (result) {
          try {
            const parsed = JSON.parse(result);
            if (Array.isArray(parsed.files)) {
              return { json: result, method: 'NESTED_SEARCH' };
            }
          } catch {
          }
        }
      }
    }
  }
  
  const jsonLikePatterns = input.match(/\{[\s\S]*"files"[\s\S]*\}[\s\S]*/);
  if (jsonLikePatterns) {
    const result = extractOutermostBraces(jsonLikePatterns[0]);
    if (result) {
      try {
        JSON.parse(result);
        return { json: result, method: 'NESTED_SEARCH' };
      } catch {
      }
    }
  }
  
  return { json: null, method: 'NESTED_SEARCH' };
}

function extractJson(input: string): { json: string | null; method: ExtractionMethod } {
  const stage1 = stage1DirectParse(input);
  if (stage1.json) return stage1;
  
  const stage2 = stage2CodeBlock(input);
  if (stage2.json) return stage2;
  
  const stage3 = stage3BraceExtraction(input);
  if (stage3.json) return stage3;
  
  const stage4 = stage4NestedSearch(input);
  if (stage4.json) return stage4;
  
  return { json: null, method: 'NONE' };
}

function validateParsedObject(obj: unknown): { valid: boolean; files: ParsedFile[]; reason?: ParseResult['failureReason'] } {
  if (typeof obj !== 'object' || obj === null) {
    return { valid: false, files: [], reason: 'INVALID_STRUCTURE' };
  }
  
  const record = obj as Record<string, unknown>;
  
  if (!Array.isArray(record.files)) {
    return { valid: false, files: [], reason: 'NO_FILES_ARRAY' };
  }
  
  const validFiles: ParsedFile[] = [];
  
  for (const item of record.files) {
    if (typeof item !== 'object' || item === null) continue;
    
    const file = item as Record<string, unknown>;
    let path = typeof file.path === 'string' ? file.path.trim() : '';
    const content = typeof file.content === 'string' ? file.content : '';
    
    if (!path) continue;

    path = path.normalize("NFC").trim();
    
    if (!hasValidExtension(path)) continue;
    
    const blockCheck = isBlockedFilename(path);
    if (blockCheck.blocked) continue;
    
    if (!content) continue;
    
    let cleanContent = content.replace(/\0/g, "").normalize("NFC");
    if (looksLikeDescription(cleanContent)) continue;
    
    validFiles.push({
      path,
      content: cleanContent,
      language: typeof file.language === 'string' ? file.language : undefined,
    });
  }
  
  if (validFiles.length === 0) {
    return { valid: false, files: [], reason: 'NO_VALID_FILES' };
  }
  
  return { valid: true, files: validFiles };
}

export function parseResponse(raw: string): ParseResult {
  const cleaned = preprocess(raw);
  
  const { json, method } = extractJson(cleaned);
  
  if (!json) {
    return {
      success: false,
      files: [],
      rawResponse: raw,
      failureReason: 'NO_JSON_FOUND',
      extractionMethod: method,
    };
  }
  
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      success: false,
      files: [],
      rawResponse: raw,
      failureReason: 'INVALID_JSON',
      extractionMethod: method,
    };
  }
  
  const validation = validateParsedObject(parsed);
  if (!validation.valid) {
    return {
      success: false,
      files: [],
      rawResponse: raw,
      failureReason: validation.reason,
      extractionMethod: method,
    };
  }
  
  const record = parsed as Record<string, unknown>;
  
  return {
    success: true,
    files: validation.files,
    summary: typeof record.summary === 'string' ? record.summary : undefined,
    rawResponse: raw,
    extractionMethod: method,
  };
}
