import type { ParseContext, ParseResult as UnifiedParseResult, IParser } from './ParserProtocol.js';
import { ResponseParser } from '../parser/response-parser.js';

/**
 * @deprecated Use ParserChain with the modern parser flow instead.
 * This adapter is kept for backwards-compatibility fallback behavior.
 */
export class LegacyResponseParser implements IParser {
  public readonly name = 'legacy-response-parser';
  public readonly priority = 100;
  private readonly parser: ResponseParser;

  constructor() {
    this.parser = new ResponseParser();
  }

  canParse(_content: string, _context: ParseContext): boolean {
    return true;
  }

  async parse(content: string, _context: ParseContext): Promise<UnifiedParseResult> {
    const result = this.parser.parse(content);
    if (result.success) {
      return {
        success: true,
        data: result,
        metadata: {
          parser: this.name,
          confidence: 0.7,
          fallbackUsed: true,
        },
      };
    }

    return {
      success: false,
      error: result.error || 'Legacy parser failed',
      metadata: {
        parser: this.name,
        confidence: 0.2,
        fallbackUsed: true,
      },
    };
  }
}
