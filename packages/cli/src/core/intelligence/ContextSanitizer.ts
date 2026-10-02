const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|auth(?:orization)?|credential|password|secret|private[_-]?key|cookie|session[_-]?token)/i;
const SECRET_VALUE = /^(?:bearer\s+)?(?:sk-|ghp_|github_pat_|xox[baprs]-|AIza|AKIA)[A-Za-z0-9._-]+$/i;

export interface ContextSanitizerOptions {
  maxStringLength?: number;
  maxArrayLength?: number;
  redactValue?: string;
}

export class ContextSanitizer {
  constructor(private readonly options: ContextSanitizerOptions = {}) {}

  sanitize<T>(value: T): T {
    return this.visit(value, new WeakSet<object>()) as T;
  }

  private visit(value: unknown, seen: WeakSet<object>): unknown {
    if (typeof value === 'string') {
      const max = this.options.maxStringLength ?? 32_000;
      return value.length > max ? value.slice(0, max) + '\n[TRUNCATED]' : value;
    }
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);

    if (Array.isArray(value)) {
      const max = this.options.maxArrayLength ?? 500;
      return value.slice(0, max).map(item => this.visit(item, seen));
    }

    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      if (SECRET_KEY.test(key) || (typeof child === 'string' && SECRET_VALUE.test(child))) {
        result[key] = this.options.redactValue ?? '[REDACTED]';
      } else {
        result[key] = this.visit(child, seen);
      }
    }
    return result;
  }
}
