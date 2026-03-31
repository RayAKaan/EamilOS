import { Logger, getLogger } from '../logger.js';
import { LeakDetector } from './LeakDetector.js';

export type SecureLogLevel = 'debug' | 'info' | 'warn' | 'error';

export class SecureLogger {
  private leakDetector: LeakDetector;
  private underlying: Logger;
  private debugEnabled: boolean;

  constructor(underlying: Logger, debugEnabled: boolean = false) {
    this.leakDetector = new LeakDetector();
    this.underlying = underlying;
    this.debugEnabled = debugEnabled || process.env.DEBUG === 'true';
  }

  log(level: SecureLogLevel, message: string, data?: Record<string, unknown>): void {
    if (level === 'debug' && !this.debugEnabled) {
      return;
    }

    const sanitizedMessage = this.sanitizeString(message);
    const sanitizedData = data ? this.sanitizeObject(data) : undefined;

    this.underlying.log(level, sanitizedMessage, sanitizedData);
  }

  security(event: string, details: Record<string, unknown>): void {
    const sanitizedDetails = this.sanitizeObject(details);
    this.underlying.warn(`[SECURITY] ${event}`, sanitizedDetails);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  success(message: string, data?: Record<string, unknown>): void {
    this.underlying.success(message, data);
  }

  private sanitizeString(str: string): string {
    const result = this.leakDetector.scan(str);
    if (result.safe) {
      return str;
    }

    let sanitized = str;
    for (const violation of result.violations) {
      const pattern = violation.match.replace('****', '');
      sanitized = sanitized.replace(new RegExp(this.escapeRegex(pattern), 'g'), '[REDACTED]');
    }
    return sanitized;
  }

  private sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        sanitized[key] = this.sanitizeString(value);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeObject(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map(item => {
          if (typeof item === 'string') {
            return this.sanitizeString(item);
          }
          if (typeof item === 'object' && item !== null) {
            return this.sanitizeObject(item as Record<string, unknown>);
          }
          return item;
        });
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

let globalSecureLogger: SecureLogger | null = null;

export function initSecureLogger(underlying: Logger, debugEnabled: boolean = false): SecureLogger {
  globalSecureLogger = new SecureLogger(underlying, debugEnabled);
  return globalSecureLogger;
}

export function getSecureLogger(): SecureLogger {
  if (!globalSecureLogger) {
    globalSecureLogger = new SecureLogger(getLogger());
  }
  return globalSecureLogger;
}
