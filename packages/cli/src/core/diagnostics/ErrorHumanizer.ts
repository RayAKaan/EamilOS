export interface ErrorPattern {
  pattern: RegExp;
  category: string;
  title: string;
  message: string;
  suggestion?: string;
  severity: 'error' | 'warning' | 'info';
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: /connection refused/i,
    category: 'network',
    title: 'Connection Refused',
    message: 'Could not connect to the server.',
    suggestion: 'Ensure the server is running. For Ollama: ollama serve',
    severity: 'error',
  },
  {
    pattern: /timeout|timed?\s*out/i,
    category: 'network',
    title: 'Request Timeout',
    message: 'The request took too long and was cancelled.',
    suggestion: 'Try again, or check your network connection.',
    severity: 'warning',
  },
  {
    pattern: /401|unauthorized|authentication/i,
    category: 'auth',
    title: 'Authentication Failed',
    message: 'The API key is invalid or missing.',
    suggestion: 'Check your API key in the config or set the OPENAI_API_KEY environment variable.',
    severity: 'error',
  },
  {
    pattern: /403|forbidden|permission/i,
    category: 'auth',
    title: 'Permission Denied',
    message: 'You do not have permission to access this resource.',
    suggestion: 'Check your API key permissions or quota.',
    severity: 'error',
  },
  {
    pattern: /429|rate\s*limit|too\s*many/i,
    category: 'quota',
    title: 'Rate Limit Exceeded',
    message: 'Too many requests. Please wait before trying again.',
    suggestion: 'Wait a few seconds and retry, or check your API quota.',
    severity: 'warning',
  },
  {
    pattern: /500|502|503|504|server\s*error/i,
    category: 'server',
    title: 'Server Error',
    message: 'The remote server encountered an error.',
    suggestion: 'This is usually temporary. Try again in a few moments.',
    severity: 'warning',
  },
  {
    pattern: /model\s*not\s*found|model\s*does\s*not\s*exist/i,
    category: 'model',
    title: 'Model Not Found',
    message: 'The specified model is not available.',
    suggestion: 'Run "ollama pull <model-name>" to install it, or choose a different model.',
    severity: 'error',
  },
  {
    pattern: /context\s*length|token\s*limit|max_tokens/i,
    category: 'model',
    title: 'Context Length Exceeded',
    message: 'The input is too long for the model context window.',
    suggestion: 'Reduce the input size or use a model with a larger context window.',
    severity: 'error',
  },
  {
    pattern: /json\s*parse|syntax\s*error|invalid\s*json/i,
    category: 'parse',
    title: 'Invalid Response Format',
    message: 'The model returned an invalid response format.',
    suggestion: 'Try again. If it persists, the model may not support this feature.',
    severity: 'warning',
  },
  {
    pattern: /ssl|certificate|tls|https/i,
    category: 'network',
    title: 'SSL/TLS Error',
    message: 'Secure connection failed.',
    suggestion: 'Check your network settings or proxy configuration.',
    severity: 'error',
  },
  {
    pattern: /econnreset|ECONNRESET|connection\s*reset/i,
    category: 'network',
    title: 'Connection Reset',
    message: 'The connection was unexpectedly closed.',
    suggestion: 'Check your network connection and try again.',
    severity: 'warning',
  },
  {
    pattern: /enotfound|getaddrinfo|dns/i,
    category: 'network',
    title: 'DNS Error',
    message: 'Could not resolve the server address.',
    suggestion: 'Check the endpoint URL in your config.',
    severity: 'error',
  },
  {
    pattern: /config\s*not\s*found|missing\s*config|no\s*config/i,
    category: 'config',
    title: 'Configuration Missing',
    message: 'No configuration file found.',
    suggestion: 'Run "eamilos setup" to create a configuration.',
    severity: 'info',
  },
  {
    pattern: /provider\s*not\s*found|unknown\s*provider/i,
    category: 'config',
    title: 'Provider Not Found',
    message: 'The specified provider is not configured.',
    suggestion: 'Check your config file or run "eamilos setup".',
    severity: 'error',
  },
  {
    pattern: /ollama\s*not\s*running|ollama\s*not\s*available/i,
    category: 'ollama',
    title: 'Ollama Not Running',
    message: 'Ollama is not running or not accessible.',
    suggestion: 'Start Ollama: ollama serve',
    severity: 'error',
  },
  {
    pattern: /no\s*such\s*file|enoent|not\s*found/i,
    category: 'file',
    title: 'File Not Found',
    message: 'A required file was not found.',
    suggestion: 'Check that all required files exist.',
    severity: 'error',
  },
  {
    pattern: /disk\s*full|ENOSPC|no\s*space/i,
    category: 'system',
    title: 'Disk Full',
    message: 'Not enough disk space available.',
    suggestion: 'Free up disk space and try again.',
    severity: 'error',
  },
  {
    pattern: /out\s*of\s*memory|OOM|ENOMEM/i,
    category: 'system',
    title: 'Out of Memory',
    message: 'The system ran out of memory.',
    suggestion: 'Close other applications or use a smaller model.',
    severity: 'error',
  },
];

export interface HumanizedError {
  original: string;
  title: string;
  message: string;
  suggestion?: string;
  category: string;
  severity: 'error' | 'warning' | 'info';
  recovery?: string;
}

export class ErrorHumanizer {
  private patterns: ErrorPattern[];
  private unknownTitle: string;
  private unknownMessage: string;

  constructor(
    patterns: ErrorPattern[] = ERROR_PATTERNS,
    unknownTitle: string = 'Something went wrong',
    unknownMessage: string = 'An unexpected error occurred.'
  ) {
    this.patterns = patterns;
    this.unknownTitle = unknownTitle;
    this.unknownMessage = unknownMessage;
  }

  humanize(error: unknown): HumanizedError {
    const errorString = this.extractErrorString(error);

    for (const pattern of this.patterns) {
      if (pattern.pattern.test(errorString)) {
        return {
          original: errorString,
          title: pattern.title,
          message: pattern.message,
          suggestion: pattern.suggestion,
          category: pattern.category,
          severity: pattern.severity,
          recovery: this.getRecoveryHint(pattern.category),
        };
      }
    }

    return {
      original: errorString,
      title: this.unknownTitle,
      message: this.unknownMessage,
      category: 'unknown',
      severity: 'error',
      recovery: 'Try again. If the problem persists, run "eamilos doctor".',
    };
  }

  private extractErrorString(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as Record<string, unknown>).message);
    }
    return String(error);
  }

  private getRecoveryHint(category: string): string | undefined {
    const hints: Record<string, string> = {
      network: 'Check your internet connection and try again.',
      auth: 'Verify your API keys in the config or environment variables.',
      quota: 'Wait a moment and try again, or upgrade your plan.',
      server: 'Wait and retry — this is usually temporary.',
      model: 'Try a different model or adjust your request.',
      parse: 'Retry the request or try a different model.',
      config: 'Run "eamilos setup" to configure EamilOS.',
      ollama: 'Start Ollama with "ollama serve" or check the Ollama installation.',
      file: 'Verify the file path and ensure it exists.',
      system: 'Check system resources and try again.',
    };
    return hints[category];
  }

  format(error: unknown): string {
    const humanized = this.humanize(error);
    const lines: string[] = [];

    lines.push(`\x1b[1m\x1b[31m${humanized.title}\x1b[0m`);
    lines.push(humanized.message);

    if (humanized.suggestion) {
      lines.push(`\x1b[2mSuggestion: ${humanized.suggestion}\x1b[0m`);
    }

    if (humanized.recovery) {
      lines.push(`\x1b[2mRecovery: ${humanized.recovery}\x1b[0m`);
    }

    return lines.join('\n');
  }

  static getCategoryColor(category: string): string {
    const colors: Record<string, string> = {
      error: '\x1b[31m',
      warning: '\x1b[33m',
      info: '\x1b[36m',
      network: '\x1b[35m',
      auth: '\x1b[31m',
      quota: '\x1b[33m',
      server: '\x1b[33m',
      model: '\x1b[34m',
      parse: '\x1b[35m',
      config: '\x1b[34m',
      ollama: '\x1b[32m',
      file: '\x1b[31m',
      system: '\x1b[31m',
      unknown: '\x1b[90m',
    };
    return colors[category] || colors.unknown;
  }
}

let globalHumanizer: ErrorHumanizer | null = null;

export function getErrorHumanizer(): ErrorHumanizer {
  if (!globalHumanizer) {
    globalHumanizer = new ErrorHumanizer();
  }
  return globalHumanizer;
}

export function humanizeError(error: unknown): HumanizedError {
  return getErrorHumanizer().humanize(error);
}

export function formatError(error: unknown): string {
  return getErrorHumanizer().format(error);
}
