import { SecretNotFoundError } from './errors.js';

export interface AuditEntry {
  timestamp: string;
  key: string;
  action: string;
  caller: string;
}

export interface ValidationResult {
  valid: boolean;
  format: string;
  error?: string;
}

export class SecretManager {
  private auditLog: AuditEntry[] = [];

  get(key: string): string {
    const value = process.env[key];
    
    if (value === undefined || value === null || value === '') {
      throw new SecretNotFoundError(key);
    }
    
    this.audit(key, 'ACCESS');
    return value;
  }

  validate(key: string): ValidationResult {
    const value = process.env[key];
    
    if (!value) {
      return { valid: true, format: 'none' };
    }

    switch (key) {
      case 'OPENAI_API_KEY':
        return this.validateOpenAIKey(value);
      case 'ANTHROPIC_API_KEY':
        return this.validateAnthropicKey(value);
      case 'OLLAMA_HOST':
        return this.validateOllamaHost(value);
      default:
        return { valid: true, format: 'unknown' };
    }
  }

  private validateOpenAIKey(value: string): ValidationResult {
    const startsWithSk = value.startsWith('sk-');
    const hasValidLength = value.length >= 40;
    
    if (startsWithSk && hasValidLength) {
      return { valid: true, format: 'sk-* (40+ chars)' };
    }
    
    return {
      valid: false,
      format: 'sk-* (40+ chars)',
      error: startsWithSk 
        ? `Key too short: ${value.length} chars (expected 40+)`
        : 'Key must start with "sk-"'
    };
  }

  private validateAnthropicKey(value: string): ValidationResult {
    const startsWithSkAnt = value.startsWith('sk-ant-');
    const hasValidLength = value.length >= 40;
    
    if (startsWithSkAnt && hasValidLength) {
      return { valid: true, format: 'sk-ant-* (40+ chars)' };
    }
    
    return {
      valid: false,
      format: 'sk-ant-* (40+ chars)',
      error: startsWithSkAnt 
        ? `Key too short: ${value.length} chars (expected 40+)`
        : 'Key must start with "sk-ant-"'
    };
  }

  private validateOllamaHost(value: string): ValidationResult {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return { valid: true, format: 'http:// or https:// URL' };
      }
      return {
        valid: false,
        format: 'http:// or https:// URL',
        error: `Invalid protocol: ${url.protocol}`
      };
    } catch {
      return {
        valid: false,
        format: 'http:// or https:// URL',
        error: 'Invalid URL format'
      };
    }
  }

  mask(value: string): string {
    if (value.length >= 12) {
      return value.substring(0, 4) + '****' + value.substring(value.length - 4);
    }
    return '********';
  }

  audit(key: string, action: string): void {
    const caller = new Error().stack?.split('\n')[2] || 'unknown';
    this.auditLog.push({
      timestamp: new Date().toISOString(),
      key: this.mask(process.env[key] || ''),
      action,
      caller: caller.trim(),
    });
  }

  getAuditLog(): readonly AuditEntry[] {
    return [...this.auditLog];
  }
}

let globalSecretManager: SecretManager | null = null;

export function initSecretManager(): SecretManager {
  globalSecretManager = new SecretManager();
  return globalSecretManager;
}

export function getSecretManager(): SecretManager {
  if (!globalSecretManager) {
    globalSecretManager = new SecretManager();
  }
  return globalSecretManager;
}
