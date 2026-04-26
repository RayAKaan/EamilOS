export interface ParseResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata: {
    parser: string;
    confidence: number;
    fallbackUsed?: boolean;
  };
}

export interface ParseContext {
  expectedFormat?: string;
  sourceProvider?: string;
  taskType?: string;
}

export interface IParser {
  name: string;
  priority: number;
  canParse(content: string, context: ParseContext): boolean;
  parse(content: string, context: ParseContext): Promise<ParseResult>;
}
