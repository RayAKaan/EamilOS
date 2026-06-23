import { ErrorClassifier, ErrorCategory, ErrorSeverity } from './ErrorClassifier.js';

export interface ErrorExplanation {
  what: string;
  why: string;
  how: string[];
  links: { text: string; url: string }[];
  modelSpecificGuidance?: Record<string, string>;
}

export interface ExplainableErrorOptions {
  includeStack?: boolean;
  includeContext?: boolean;
  includeModelGuidance?: boolean;
  verbose?: boolean;
}

const ERROR_EXPLANATIONS: Record<ErrorCategory, ErrorExplanation> = {
  [ErrorCategory.PARSE_ERROR]: {
    what: 'The model returned a response that could not be parsed',
    why: 'Models sometimes generate incomplete JSON or text that doesn\'t match the expected format. This often happens when the model is interrupted or encounters edge cases.',
    how: [
      'Add explicit format instructions in your prompt',
      'Use response_format parameter if available',
      'Implement retry logic with modified prompts',
      'Consider using a more structured prompting approach',
    ],
    links: [
      { text: 'JSON parsing best practices', url: 'https://platform.openai.com/docs/guides/text-generation' },
    ],
  },
  [ErrorCategory.MODEL_ERROR]: {
    what: 'The AI model encountered an error during inference',
    why: 'This can occur due to model overload, invalid parameters, or internal server issues. Cloud providers may also impose limits on request complexity.',
    how: [
      'Retry the request with exponential backoff',
      'Reduce the complexity of your request',
      'Check if the model is experiencing outages',
      'Consider using a fallback model',
    ],
    links: [
      { text: 'Model error troubleshooting', url: 'https://help.openai.com' },
    ],
  },
  [ErrorCategory.NETWORK_ERROR]: {
    what: 'A network connection could not be established',
    why: 'Network errors occur when the client cannot reach the API endpoint. This can be due to firewall rules, DNS issues, or temporary service disruption.',
    how: [
      'Verify your internet connection',
      'Check firewall and proxy settings',
      'Ensure the API endpoint URL is correct',
      'Retry with increased timeout values',
    ],
    links: [
      { text: 'Network troubleshooting guide', url: 'https://docs.python-requests.org/en/latest/user/quickstart/' },
    ],
  },
  [ErrorCategory.AUTH_ERROR]: {
    what: 'Authentication with the API provider failed',
    why: 'This typically means the API key is invalid, expired, or lacks the necessary permissions. Some providers require additional configuration.',
    how: [
      'Verify your API key is correctly set',
      'Check if the key has the required permissions/scopes',
      'Ensure the key hasn\'t expired or been revoked',
      'Review the provider\'s authentication documentation',
    ],
    links: [
      { text: 'API key management', url: 'https://platform.openai.com/docs/api-authentication' },
    ],
  },
  [ErrorCategory.RATE_LIMIT_ERROR]: {
    what: 'Too many requests have been made in a short time',
    why: 'API providers impose rate limits to ensure fair usage. Exceeding these limits temporarily blocks new requests.',
    how: [
      'Implement exponential backoff between requests',
      'Add request queuing to your application',
      'Consider upgrading to a higher tier plan',
      'Monitor your request volume and usage patterns',
    ],
    links: [
      { text: 'Rate limiting best practices', url: 'https://platform.openai.com/docs/guides/rate-limits' },
    ],
  },
  [ErrorCategory.TIMEOUT_ERROR]: {
    what: 'The request took too long to complete',
    why: 'Timeouts occur when the model or network is slow to respond. Large requests, complex tasks, or server load can all contribute to this.',
    how: [
      'Increase the timeout duration',
      'Reduce the input size or complexity',
      'Split large tasks into smaller chunks',
      'Try during off-peak hours',
    ],
    links: [
      { text: 'Optimizing inference speed', url: 'https://platform.openai.com/docs/guides/text-generation' },
    ],
  },
  [ErrorCategory.VALIDATION_ERROR]: {
    what: 'The request data failed validation',
    why: 'Input validation errors occur when the data sent to the API doesn\'t meet requirements. This includes format, size, or missing required fields.',
    how: [
      'Review the API documentation for input requirements',
      'Validate your input data before sending',
      'Check for special characters or encoding issues',
      'Ensure all required fields are present',
    ],
    links: [
      { text: 'API reference documentation', url: 'https://platform.openai.com/docs/api-reference' },
    ],
  },
  [ErrorCategory.SYSTEM_ERROR]: {
    what: 'An internal system error occurred',
    why: 'System errors indicate problems on the provider\'s infrastructure. These are usually temporary and resolve themselves.',
    how: [
      'Wait and retry after a short delay',
      'Check provider status pages',
      'Report persistent issues to support',
      'Consider alternative providers as backup',
    ],
    links: [
      { text: 'System status page', url: 'https://status.openai.com' },
    ],
  },
  [ErrorCategory.UNKNOWN_ERROR]: {
    what: 'An unexpected error occurred',
    why: 'This error doesn\'t match known patterns. It could be a new error type, a custom error, or an error from an unexpected source.',
    how: [
      'Check the error details and stack trace',
      'Search for the error message online',
      'Review recent code changes',
      'Enable verbose logging for more details',
    ],
    links: [],
  },
};

const MODEL_SPECIFIC_GUIDANCE: Record<string, Partial<Record<ErrorCategory, string>>> = {
  ollama: {
    [ErrorCategory.MODEL_ERROR]: 'Ensure Ollama is running with `ollama serve`. Check available models with `ollama list`.',
    [ErrorCategory.NETWORK_ERROR]: 'Ollama runs on localhost:11434. Ensure no firewall is blocking local connections.',
  },
  openai: {
    [ErrorCategory.RATE_LIMIT_ERROR]: 'Check your OpenAI usage dashboard at platform.openai.com/usage',
    [ErrorCategory.AUTH_ERROR]: 'Verify your API key at platform.openai.com/api-keys',
  },
  anthropic: {
    [ErrorCategory.RATE_LIMIT_ERROR]: 'Check your Anthropic console for usage limits',
    [ErrorCategory.AUTH_ERROR]: 'Verify your Anthropic API key at console.anthropic.com',
  },
};

export class ExplainableError extends Error {
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly isRetryable: boolean;
  public readonly isRecoverable: boolean;
  public readonly context: Record<string, unknown>;
  private explanation: ErrorExplanation;
  private options: ExplainableErrorOptions;

  constructor(error: Error | string, context?: Record<string, unknown>, options: ExplainableErrorOptions = {}) {
    const message = error instanceof Error ? error.message : String(error);
    super(message);
    this.name = 'ExplainableError';
    if (error instanceof Error) {
      this.stack = error.stack;
    }
    this.context = context || {};
    this.options = options;
    const classifier = new ErrorClassifier();
    const classified = classifier.classify(error, context);
    this.category = classified.category;
    this.severity = classified.severity;
    this.isRetryable = classified.isRetryable;
    this.isRecoverable = classified.isRecoverable;
    this.explanation = ERROR_EXPLANATIONS[this.category];
  }

  explain(): string {
    const lines: string[] = [];
    const severityIcon = this.getSeverityIcon();

    lines.push(`\n${severityIcon} Error: ${this.message}\n`);
    lines.push('─'.repeat(50));
    lines.push(`\n📋 What happened:`);
    lines.push(`   ${this.explanation.what}`);
    lines.push(`\n🔍 Why it occurred:`);
    lines.push(`   ${this.explanation.why}`);
    lines.push(`\n🛠️ How to fix:`);

    this.explanation.how.forEach((step, i) => {
      lines.push(`   ${i + 1}. ${step}`);
    });

    if (this.options.includeContext && Object.keys(this.context).length > 0) {
      lines.push('\n📊 Context:');
      for (const [key, value] of Object.entries(this.context)) {
        lines.push(`   • ${key}: ${JSON.stringify(value)}`);
      }
    }

    if (this.options.includeModelGuidance && this.context.provider) {
      const provider = String(this.context.provider);
      const guidance = MODEL_SPECIFIC_GUIDANCE[provider]?.[this.category];
      if (guidance) {
        lines.push(`\n💡 Provider-specific (${provider}):`);
        lines.push(`   ${guidance}`);
      }
    }

    if (this.explanation.links.length > 0) {
      lines.push('\n📚 Learn more:');
      this.explanation.links.forEach(link => {
        lines.push(`   • ${link.text}: ${link.url}`);
      });
    }

    if (this.options.verbose && this.stack) {
      lines.push('\n🔧 Stack trace:');
      lines.push(`   ${this.stack}`);
    }

    lines.push('\n' + '─'.repeat(50));
    if (this.isRetryable) {
      lines.push('ℹ️ This error is retryable.');
    }
    if (!this.isRecoverable) {
      lines.push('⚠️ This error may require manual intervention.');
    }

    return lines.join('\n');
  }

  private getSeverityIcon(): string {
    switch (this.severity) {
      case ErrorSeverity.CRITICAL: return '🔴';
      case ErrorSeverity.HIGH: return '🟠';
      case ErrorSeverity.MEDIUM: return '🟡';
      case ErrorSeverity.LOW: return '🟢';
      default: return '⚪';
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      severity: this.severity,
      isRetryable: this.isRetryable,
      isRecoverable: this.isRecoverable,
      context: this.context,
      explanation: this.explanation,
    };
  }
}

export function explainError(
  error: Error | string,
  context?: Record<string, unknown>,
  options?: ExplainableErrorOptions
): ExplainableError {
  return new ExplainableError(error, context, options);
}

export function formatErrorForUser(error: Error | string, context?: Record<string, unknown>): string {
  const explainable = new ExplainableError(error, context, {
    includeContext: true,
    includeModelGuidance: true,
  });
  return explainable.explain();
}
