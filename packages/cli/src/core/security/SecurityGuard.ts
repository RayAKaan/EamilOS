import { LeakDetector } from './LeakDetector.js';
import { SecureLogger } from './SecureLogger.js';

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ArtifactValidationResult {
  safe: boolean;
  violations: string[];
}

const FORBIDDEN_KEYS = ['api_key', 'secret', 'token', 'password', 'credential', 'auth'];

export class SecurityGuard {
  private leakDetector: LeakDetector;
  private logger: SecureLogger;

  constructor(logger: SecureLogger) {
    this.leakDetector = new LeakDetector();
    this.logger = logger;
  }

  validateConfig(config: Record<string, unknown>): ConfigValidationResult {
    const errors: string[] = [];

    for (const key of FORBIDDEN_KEYS) {
      const configKey = config[key];
      if (configKey !== undefined && configKey !== null && configKey !== '') {
        if (typeof configKey === 'string' && configKey.length > 0) {
          errors.push(
            `Do not hardcode secrets in config. Use environment variables. Found: ${key}`
          );
        }
      }
    }

    const scanResult = this.leakDetector.scanObject(config);
    if (!scanResult.safe) {
      errors.push(...scanResult.violations);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  validateArtifact(file: { path: string; content: string }): ArtifactValidationResult {
    const scanResult = this.leakDetector.scanFile(file);

    if (!scanResult.safe) {
      this.logger.security('Artifact validation failed', {
        path: file.path,
        violations: scanResult.violations,
      });

      return {
        safe: false,
        violations: scanResult.violations.map(v => `${v.location}: ${v.pattern}`),
      };
    }

    return {
      safe: true,
      violations: [],
    };
  }

  sanitizeAgentContext(context: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const secretKeyPattern = /key|secret|token|password|credential|auth/i;

    for (const [key, value] of Object.entries(context)) {
      if (secretKeyPattern.test(key)) {
        continue;
      }

      if (typeof value === 'string') {
        const scanResult = this.leakDetector.scan(value);
        sanitized[key] = scanResult.safe 
          ? value 
          : value.replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED]')
                 .replace(/sk-ant-[a-zA-Z0-9]{20,}/g, '[REDACTED]')
                 .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED]')
                 .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/g, '[REDACTED]');
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeAgentContext(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map(item => {
          if (typeof item === 'string') {
            const scanResult = this.leakDetector.scan(item);
            return scanResult.safe ? item : '[REDACTED]';
          }
          if (typeof item === 'object' && item !== null) {
            return this.sanitizeAgentContext(item as Record<string, unknown>);
          }
          return item;
        });
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}
