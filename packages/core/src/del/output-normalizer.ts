import { RawProviderOutput, NormalizedProviderOutput, OutputFormat } from './provider-types.js';

const ANSI_ESCAPE_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const PROMPT_REGEX = /\?\s*(Do you want to|Proceed|Y\/N|Continue)\s*\??/gi;
const PROGRESS_REGEX = /(\d+%|\[\s*#*\s*\]|====+)/g;

export class OutputNormalizer {
  normalize(output: RawProviderOutput): NormalizedProviderOutput {
    const sanitized = this.sanitize(output);
    const format = this.detectFormat(sanitized);

    return {
      providerId: output.providerId,
      sanitizedText: sanitized,
      format,
    };
  }

  sanitize(output: RawProviderOutput): string {
    let text = output.rawText;

    text = text.replace(ANSI_ESCAPE_REGEX, '');

    text = text.replace(PROMPT_REGEX, '');

    text = text.replace(PROGRESS_REGEX, '');

    text = this.normalizeWhitespace(text);

    text = text.trim();

    return text;
  }

  private normalizeWhitespace(text: string): string {
    const lines = text.split('\n');
    const normalizedLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        if (normalizedLines[normalizedLines.length - 1] !== '') {
          normalizedLines.push('');
        }
      } else {
        normalizedLines.push(trimmed);
      }
    }

    while (normalizedLines.length > 0 && normalizedLines[0] === '') {
      normalizedLines.shift();
    }

    while (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1] === '') {
      normalizedLines.pop();
    }

    return normalizedLines.join('\n');
  }

  detectFormat(text: string): OutputFormat {
    const trimmed = text.trim();

    if (this.looksLikeJson(trimmed)) {
      return 'json';
    }

    if (this.looksLikeMarkdown(trimmed)) {
      return 'markdown';
    }

    return 'text';
  }

  private looksLikeJson(text: string): boolean {
    const trimmed = text.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
           (trimmed.startsWith('[') && trimmed.endsWith(']'));
  }

  private looksLikeMarkdown(text: string): boolean {
    const markdownIndicators = [
      /^#{1,6}\s/m,
      /^\*\*.*\*\*/m,
      /^\*.*\*/m,
      /^```\w*/m,
      /^\|.*\|/m,
      /^-{3,}$/m,
    ];

    let matchCount = 0;
    for (const pattern of markdownIndicators) {
      if (pattern.test(text)) {
        matchCount++;
      }
    }

    return matchCount >= 2;
  }

  extractJsonPayload(text: string): unknown | null {
    try {
      const trimmed = text.trim();

      let jsonStr = trimmed;
      if (trimmed.startsWith('```json')) {
        jsonStr = trimmed.slice(7, -3);
      } else if (trimmed.startsWith('```')) {
        jsonStr = trimmed.slice(3, -3);
      }

      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }

  hasInteractivePrompt(text: string): boolean {
    return PROMPT_REGEX.test(text);
  }

  stripCodeBlocks(text: string): string {
    return text.replace(/```[\w]*\n?/g, '').replace(/```/g, '');
  }
}

let globalNormalizer: OutputNormalizer | null = null;

export function getOutputNormalizer(): OutputNormalizer {
  if (!globalNormalizer) {
    globalNormalizer = new OutputNormalizer();
  }
  return globalNormalizer;
}

export function createOutputNormalizer(): OutputNormalizer {
  return new OutputNormalizer();
}