import type { ExecutionStrategy } from './types.js';
import type { ParseResult } from '../parsers/ResponseParser.js';

export class TaskSplitter {
  constructor() {}

  shouldSplit(instruction: string, strategy: ExecutionStrategy): boolean {
    if (!strategy.requiresTaskSplitting) {
      return false;
    }

    if (instruction.length > strategy.maxTaskSizeChars) {
      return true;
    }

    const fileIndicators = this.detectMultipleFiles(instruction);
    if (fileIndicators.length >= 2) {
      return true;
    }

    const enumeratedPattern = /(?:^|\s)\d+\.\s+\w+/m;
    if (enumeratedPattern.test(instruction)) {
      return true;
    }

    return false;
  }

  private detectMultipleFiles(instruction: string): string[] {
    const extensions = [
      '.html', '.css', '.js', '.ts', '.jsx', '.tsx',
      '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h',
      '.json', '.yaml', '.yml', '.md', '.txt',
      '.sh', '.bash', '.zsh',
      '.sql', '.xml', '.toml', '.ini',
    ];

    const foundExtensions: string[] = [];
    const lowerInstruction = instruction.toLowerCase();

    for (const ext of extensions) {
      if (lowerInstruction.includes(ext)) {
        foundExtensions.push(ext);
      }
    }

    const conjunctionPatterns = [
      /(?:,|and|with|also)\s+(?:\w+\s+)*(?:\w+\.(?:html?|css|js|ts|py|md|json))/gi,
      /(?:\w+\.(?:html?|css|js|ts|py|md|json)\s*(?:,|and|with|also))/gi,
    ];

    for (const pattern of conjunctionPatterns) {
      const matches = instruction.match(pattern);
      if (matches && matches.length >= 2) {
        return matches.map(m => this.extractExtension(m));
      }
    }

    return foundExtensions;
  }

  private extractExtension(str: string): string {
    const exts = ['.html', '.css', '.js', '.ts', '.jsx', '.tsx', '.py', '.json', '.md', '.txt'];
    for (const ext of exts) {
      if (str.toLowerCase().includes(ext)) {
        return ext;
      }
    }
    return '.txt';
  }

  split(instruction: string): string[] {
    const items = this.extractEnumeratedItems(instruction);
    
    if (items.length === 0) {
      const detected = this.detectFilesFromContext(instruction);
      if (detected.length > 0) {
        return this.createSplitInstructions(instruction, detected);
      }
      return [instruction];
    }

    const maxSplit = 5;
    const truncatedItems = items.slice(0, maxSplit);

    return truncatedItems.map((item) => {
      return `From the following project: ${instruction}

Create ONLY this single file: ${item}

Output as JSON: {"summary":"...","files":[{"path":"...","content":"..."}]}`;
    });
  }

  private extractEnumeratedItems(instruction: string): string[] {
    const numberedPattern = /(?:^|\n)\s*(\d+)[.)]\s+(.+?)(?=\n\s*\d+[.)]|$)/gi;
    const items: string[] = [];
    let match;

    while ((match = numberedPattern.exec(instruction)) !== null) {
      items.push(match[2].trim());
    }

    if (items.length === 0) {
      const andPattern = /(?:,|and|with)\s+(?=\w+\s*(?:\.|,|and|with|$))/gi;
      const parts = instruction.split(andPattern).filter(p => p.trim().length > 5);
      
      if (parts.length >= 2) {
        return parts.map(p => p.trim());
      }
    }

    return items;
  }

  private detectFilesFromContext(instruction: string): string[] {
    const patterns = [
      /(?:create|build|write|make)\s+(?:a\s+|an\s+)?(\w+(?:\.\w+)?)/gi,
      /(?:with|including|using)\s+(?:file\s+)?(\w+\.\w+)/gi,
    ];

    const files = new Set<string>();
    const exts = ['.html', '.css', '.js', '.ts', '.py', '.json', '.md', '.txt'];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(instruction)) !== null) {
        for (const ext of exts) {
          if (match[1].toLowerCase().includes(ext)) {
            files.add(match[1]);
          }
        }
      }
    }

    return Array.from(files);
  }

  private createSplitInstructions(originalInstruction: string, files: string[]): string[] {
    return files.map(file => {
      return `From the following project: ${originalInstruction}

Create ONLY this single file: ${file}

Output as JSON: {"summary":"...","files":[{"path":"${file}","content":"..."}]}`;
    });
  }

  reassemble(results: ParseResult[]): ParseResult {
    const allFiles: any[] = [];
    const summaries: string[] = [];

    for (const result of results) {
      if (result.success) {
        allFiles.push(...result.files);
        if (result.summary) {
          summaries.push(result.summary);
        }
      }
    }

    const fileMap = new Map<string, any>();
    for (const file of allFiles) {
      fileMap.set(file.path, file);
    }

    const dedupedFiles = Array.from(fileMap.values());

    return {
      success: dedupedFiles.length > 0,
      files: dedupedFiles,
      summary: summaries.join(' | ') || undefined,
      rawResponse: JSON.stringify({ files: dedupedFiles, summary: summaries.join(' | ') }),
      extractionMethod: 'DIRECT_PARSE' as const,
    };
  }
}
