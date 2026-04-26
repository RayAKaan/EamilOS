import { parseResponse } from './ResponseParser.js';
import { LegacyResponseParser } from './response-parser.js';
import type { IParser, ParseContext, ParseResult } from './ParserProtocol.js';

class ModernResponseParserAdapter implements IParser {
  public readonly name = 'response-parser-modern';
  public readonly priority = 1000;

  canParse(_content: string, _context: ParseContext): boolean {
    return true;
  }

  async parse(content: string, _context: ParseContext): Promise<ParseResult> {
    const result = parseResponse(content);
    if (result.success) {
      return {
        success: true,
        data: result,
        metadata: {
          parser: this.name,
          confidence: 0.95,
        },
      };
    }

    return {
      success: false,
      error: result.failureReason || 'Modern parser failed',
      metadata: {
        parser: this.name,
        confidence: 0.35,
      },
    };
  }
}

export class ParserChain implements IParser {
  public readonly name = 'unified-chain';
  public readonly priority = 999;
  private readonly parsers: IParser[] = [];

  constructor() {
    this.parsers.push(new ModernResponseParserAdapter());
    this.parsers.push(new LegacyResponseParser());
  }

  canParse(_content: string, _context: ParseContext): boolean {
    return true;
  }

  async parse(content: string, context: ParseContext): Promise<ParseResult> {
    const errors: string[] = [];

    for (const parser of this.parsers) {
      try {
        if (!parser.canParse(content, context)) {
          continue;
        }
        const result = await parser.parse(content, context);
        if (result.success) {
          return {
            ...result,
            metadata: {
              ...result.metadata,
              confidence: result.metadata.confidence * 0.9 + parser.priority / 1000,
              fallbackUsed: parser.name !== 'response-parser-modern',
            },
          };
        }
        errors.push(`${parser.name}: ${result.error || 'unknown parser error'}`);
      } catch (error) {
        errors.push(`${parser.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      success: false,
      error: `All parsers failed: ${errors.join('; ')}`,
      metadata: {
        parser: this.name,
        confidence: 0,
      },
    };
  }

  addParser(parser: IParser): void {
    this.parsers.push(parser);
    this.parsers.sort((a, b) => b.priority - a.priority);
  }
}
