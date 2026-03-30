import { ParseResult, FileOutput, StructuredOutput, StructuredOutputSchema } from '../schemas/structured-output.js';

export class ResponseParser {
  parse(content: string): ParseResult {
    const trimmed = content.trim();
    
    const structuredResult = this.tryStructuredJSON(trimmed);
    if (structuredResult.success) {
      return structuredResult;
    }
    
    const singleBlockResult = this.trySingleCodeBlock(trimmed);
    if (singleBlockResult.success) {
      return singleBlockResult;
    }
    
    const fallbackResult = this.tryFallbackParsing(trimmed);
    if (fallbackResult.success) {
      return fallbackResult;
    }
    
    return {
      success: false,
      files: [],
      error: 'No valid files could be extracted from response',
      parseMethod: 'none',
    };
  }

  private tryStructuredJSON(content: string): ParseResult {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, files: [], parseMethod: 'structured' };
    }

    const jsonStr = jsonMatch[0];
    
    try {
      const parsed = JSON.parse(jsonStr);
      const result = StructuredOutputSchema.safeParse(parsed);
      
      if (result.success) {
        const output = result.data as StructuredOutput;
        return {
          success: true,
          files: output.files.map(f => ({
            filePath: f.filePath,
            content: f.content,
            language: f.language,
          })),
          parseMethod: 'structured',
        };
      }
      
      const fileResult = this.parseFilesArray(parsed);
      if (fileResult.success) {
        return fileResult;
      }

      return {
        success: false,
        files: [],
        error: 'JSON does not match expected schema',
        parseMethod: 'structured',
        rawContent: jsonStr,
      };
    } catch (e) {
      return {
        success: false,
        files: [],
        error: `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
        parseMethod: 'structured',
        rawContent: jsonStr,
      };
    }
  }

  private parseFilesArray(obj: Record<string, unknown>): ParseResult {
    const files = obj.files;
    if (!Array.isArray(files) || files.length === 0) {
      return { success: false, files: [], parseMethod: 'structured' };
    }

    const validFiles: FileOutput[] = [];
    for (const item of files) {
      if (typeof item === 'object' && item !== null && 'filePath' in item && 'content' in item) {
        const file = item as Record<string, unknown>;
        if (typeof file.filePath === 'string' && typeof file.content === 'string') {
          validFiles.push({
            filePath: file.filePath,
            content: file.content,
            language: typeof file.language === 'string' ? file.language : undefined,
          });
        }
      }
    }

    if (validFiles.length === 0) {
      return { success: false, files: [], parseMethod: 'structured' };
    }

    return {
      success: true,
      files: validFiles,
      parseMethod: 'structured',
    };
  }

  private trySingleCodeBlock(content: string): ParseResult {
    const codeBlockRegex = /```(\w+)?\s*\n?([\s\S]*?)```/g;
    const matches = [...content.matchAll(codeBlockRegex)];
    
    if (matches.length !== 1) {
      return { success: false, files: [], parseMethod: 'codeblock' };
    }

    const match = matches[0];
    const language = match[1] || '';
    const code = match[2].trim();

    if (!code || !this.looksLikeCode(code)) {
      return { success: false, files: [], parseMethod: 'codeblock' };
    }

    const beforeBlock = content.substring(0, match.index || 0);
    const filePath = this.extractFilePath(beforeBlock, language);

    return {
      success: true,
      files: [{
        filePath,
        content: code,
        language: language || undefined,
      }],
      parseMethod: 'codeblock',
    };
  }

  private tryFallbackParsing(content: string): ParseResult {
    const codeBlockRegex = /```(\w+)?\s*\n?([\s\S]*?)```/g;
    const matches = [...content.matchAll(codeBlockRegex)];
    
    const files: FileOutput[] = [];
    let lastBlockEnd = 0;

    for (const match of matches) {
      const language = match[1] || '';
      const code = match[2].trim();
      const blockStart = match.index || 0;

      if (!code || !this.looksLikeCode(code)) {
        continue;
      }

      const beforeBlock = content.substring(lastBlockEnd, blockStart);
      const filePath = this.extractFilePath(beforeBlock, language);

      if (!files.some(f => f.filePath === filePath)) {
        files.push({
          filePath,
          content: code,
          language: language || undefined,
        });
      }

      lastBlockEnd = (blockStart || 0) + match[0].length;
    }

    if (files.length === 0) {
      return {
        success: false,
        files: [],
        error: 'Fallback parser found no valid code blocks',
        parseMethod: 'fallback',
      };
    }

    return {
      success: true,
      files,
      parseMethod: 'fallback',
    };
  }

  private extractFilePath(context: string, _language: string): string {
    const explicitPatterns = [
      /(?:here(?:'s| is)?\s+(?:the\s+)?(?:file\s+)?(?:named?|called?)\s+)?['"`]?([\w./-]+\.\w+)['"`]?\s*:/i,
      /(?:create|write|save)\s+(?:a\s+)?(?:file\s+)?(?:named?|called?)?\s+['"`]?([\w./-]+\.\w+)/i,
      /[\s:]('[\w./-]+\.\w+'|"[\w./-]+\.\w+"|`[\w./-]+\.\w+`)/i,
    ];

    for (const pattern of explicitPatterns) {
      const match = context.match(pattern);
      if (match && match[1]) {
        const fp = match[1].replace(/['"`]/g, '');
        if (this.isValidFilePath(fp)) {
          return fp;
        }
      }
    }

    return this.inferFilePath(_language);
  }

  private isValidFilePath(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const validExts = ['py', 'js', 'ts', 'tsx', 'jsx', 'go', 'rs', 'java', 'cpp', 'c', 'h', 'sh', 'yaml', 'yml', 'json', 'md', 'txt', 'css', 'html', 'xml'];
    return validExts.includes(ext) && path.length > 3;
  }

  private inferFilePath(language: string): string {
    const langMap: Record<string, string> = {
      python: 'main.py',
      py: 'main.py',
      javascript: 'main.js',
      js: 'main.js',
      typescript: 'main.ts',
      ts: 'main.ts',
      tsx: 'main.tsx',
      jsx: 'main.jsx',
      go: 'main.go',
      rust: 'main.rs',
      rs: 'main.rs',
      java: 'Main.java',
      cpp: 'main.cpp',
      c: 'main.c',
      h: 'main.h',
      sh: 'script.sh',
      bash: 'script.sh',
      yaml: 'config.yaml',
      yml: 'config.yml',
      json: 'data.json',
      md: 'README.md',
    };

    return langMap[language.toLowerCase()] || 'output.txt';
  }

  private looksLikeCode(text: string): boolean {
    const codeIndicators = [
      /\bfunction\b/,
      /\bdef\b/,
      /\bclass\b/,
      /\bconst\b/,
      /\blet\b/,
      /\bvar\b/,
      /\bimport\b/,
      /\bexport\b/,
      /\bprint\(/,
      /\bconsole\.log\(/,
      /\breturn\b/,
      /\basync\b/,
      /\bawait\b/,
      /\{[\s\S]*\}/,
      /def\s+\w+\s*\(/,
      /func\s+\w+\s*\(/,
      /\bfunc\b/,
      /\bfn\b/,
      /\bimpl\b/,
      /\bpub\b/,
      /\bstruct\b/,
      /\benum\b/,
      /\bpackage\b/,
      /\bvoid\b/,
      /\bint\b/,
      /\bstring\b/,
    ];

    const matchCount = codeIndicators.filter(indicator => indicator.test(text)).length;
    return matchCount >= 1 && text.length > 10;
  }
}

let globalParser: ResponseParser | null = null;

export function getResponseParser(): ResponseParser {
  if (!globalParser) {
    globalParser = new ResponseParser();
  }
  return globalParser;
}

export function initResponseParser(): ResponseParser {
  globalParser = new ResponseParser();
  return globalParser;
}
