export enum ErrorCategory {
  PARSE_ERROR = 'parse_error',
  MODEL_ERROR = 'model_error',
  NETWORK_ERROR = 'network_error',
  AUTH_ERROR = 'auth_error',
  RATE_LIMIT_ERROR = 'rate_limit_error',
  TIMEOUT_ERROR = 'timeout_error',
  VALIDATION_ERROR = 'validation_error',
  SYSTEM_ERROR = 'system_error',
  UNKNOWN_ERROR = 'unknown_error',
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface ClassifiedError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  isRetryable: boolean;
  isRecoverable: boolean;
  suggestedAction: string;
  context: Record<string, any>;
}

export class ErrorClassifier {
  private static readonly PATTERNS: Map<ErrorCategory, RegExp[]> = new Map([
    [ErrorCategory.PARSE_ERROR, [
      /JSON\.parse/i,
      /unexpected token/i,
      /invalid json/i,
      /syntax error/i,
      /Unexpected end of JSON/i,
    ]],
    [ErrorCategory.MODEL_ERROR, [
      /model.*error/i,
      /completion.*failed/i,
      /inference.*error/i,
      /model.*not found/i,
      /unsupported.*model/i,
    ]],
    [ErrorCategory.NETWORK_ERROR, [
      /ECONNREFUSED/i,
      /ENOTFOUND/i,
      /ETIMEDOUT/i,
      /socket hang up/i,
      /network.*error/i,
      /fetch.*failed/i,
    ]],
    [ErrorCategory.AUTH_ERROR, [
      /401/i,
      /403/i,
      /authentication.*failed/i,
      /unauthorized/i,
      /invalid.*api.*key/i,
      /api.*key.*invalid/i,
    ]],
    [ErrorCategory.RATE_LIMIT_ERROR, [
      /429/i,
      /rate.*limit/i,
      /too many requests/i,
      /quota.*exceeded/i,
      /max.*requests/i,
    ]],
    [ErrorCategory.TIMEOUT_ERROR, [
      /timeout/i,
      /timed out/i,
      /ETIMEDOUT/i,
      /request.*timeout/i,
      /deadline.*exceeded/i,
    ]],
    [ErrorCategory.VALIDATION_ERROR, [
      /validation.*failed/i,
      /invalid.*input/i,
      /schema.*error/i,
      /constraint.*violation/i,
    ]],
  ]);

  classify(error: Error | string, context?: Record<string, any>): ClassifiedError {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : 'Error';
    const combinedMessage = `${errorName}: ${errorMessage}`;

    for (const [category, patterns] of ErrorClassifier.PATTERNS) {
      if (patterns.some(pattern => pattern.test(combinedMessage))) {
        return this.createClassifiedError(category, error, context);
      }
    }

    return this.createClassifiedError(ErrorCategory.UNKNOWN_ERROR, error, context);
  }

  private createClassifiedError(
    category: ErrorCategory,
    error: Error | string,
    context?: Record<string, any>
  ): ClassifiedError {
    const severity = this.determineSeverity(category);
    const isRetryable = this.isRetryableCategory(category);
    const isRecoverable = this.isRecoverableCategory(category);
    const suggestedAction = this.getSuggestedAction(category);

    return {
      category,
      severity,
      isRetryable,
      isRecoverable,
      suggestedAction,
      context: {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : 'Error',
        timestamp: new Date().toISOString(),
        ...context,
      },
    };
  }

  private determineSeverity(category: ErrorCategory): ErrorSeverity {
    switch (category) {
      case ErrorCategory.AUTH_ERROR:
      case ErrorCategory.RATE_LIMIT_ERROR:
        return ErrorSeverity.MEDIUM;
      case ErrorCategory.TIMEOUT_ERROR:
      case ErrorCategory.NETWORK_ERROR:
        return ErrorSeverity.MEDIUM;
      case ErrorCategory.MODEL_ERROR:
        return ErrorSeverity.HIGH;
      case ErrorCategory.PARSE_ERROR:
        return ErrorSeverity.HIGH;
      case ErrorCategory.SYSTEM_ERROR:
        return ErrorSeverity.CRITICAL;
      default:
        return ErrorSeverity.LOW;
    }
  }

  private isRetryableCategory(category: ErrorCategory): boolean {
    const nonRetryable = [
      ErrorCategory.AUTH_ERROR,
      ErrorCategory.VALIDATION_ERROR,
      ErrorCategory.UNKNOWN_ERROR,
    ];
    return !nonRetryable.includes(category);
  }

  private isRecoverableCategory(category: ErrorCategory): boolean {
    const nonRecoverable = [
      ErrorCategory.AUTH_ERROR,
      ErrorCategory.SYSTEM_ERROR,
    ];
    return !nonRecoverable.includes(category);
  }

  private getSuggestedAction(category: ErrorCategory): string {
    switch (category) {
      case ErrorCategory.PARSE_ERROR:
        return 'Review response format and consider using a different parsing strategy or stricter prompt';
      case ErrorCategory.MODEL_ERROR:
        return 'Consider switching to a different model or reducing request complexity';
      case ErrorCategory.NETWORK_ERROR:
        return 'Check network connectivity and retry with exponential backoff';
      case ErrorCategory.AUTH_ERROR:
        return 'Verify API credentials are correct and have not expired';
      case ErrorCategory.RATE_LIMIT_ERROR:
        return 'Implement rate limiting and wait before retrying';
      case ErrorCategory.TIMEOUT_ERROR:
        return 'Increase timeout duration or reduce request size';
      case ErrorCategory.VALIDATION_ERROR:
        return 'Review input data and ensure it meets schema requirements';
      case ErrorCategory.SYSTEM_ERROR:
        return 'Report to system administrators and escalate immediately';
      default:
        return 'Review error details and implement appropriate error handling';
    }
  }

  getCategories(): ErrorCategory[] {
    return Object.values(ErrorCategory);
  }

  getSeverityLevels(): ErrorSeverity[] {
    return Object.values(ErrorSeverity);
  }
}
