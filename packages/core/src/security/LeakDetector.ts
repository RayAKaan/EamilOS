export interface Violation {
  pattern: string;
  match: string;
}

export interface FileViolation {
  location: string;
  pattern: string;
  match: string;
}

export interface ScanResult {
  safe: boolean;
  violations: Violation[];
}

export interface FileScanResult {
  safe: boolean;
  violations: FileViolation[];
}

export interface ObjectScanResult {
  safe: boolean;
  violations: string[];
}

export class LeakDetector {
  private static readonly PATTERNS: Array<{ name: string; pattern: RegExp }> = [
    { name: 'OpenAI API Key', pattern: /sk-[a-zA-Z0-9]{20,}/ },
    { name: 'Anthropic API Key', pattern: /sk-ant-[a-zA-Z0-9]{20,}/ },
    { name: 'Generic API Key Assignment', pattern: /api[_-]?key\s*[=:]\s*["']?[a-zA-Z0-9]{20,}/i },
    { name: 'Bearer Token', pattern: /Authorization:\s*Bearer\s+[a-zA-Z0-9._-]{20,}/i },
    { name: 'Private Key Block', pattern: /-----BEGIN (?:RSA )?PRIVATE KEY-----/ },
    { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
    { name: 'Generic Secret Assignment', pattern: /secret[_-]?key\s*[=:]\s*["']?[a-zA-Z0-9]{16,}/i },
  ];

  scan(content: string): ScanResult {
    const violations: Violation[] = [];

    for (const { name, pattern } of LeakDetector.PATTERNS) {
      let match: RegExpExecArray | null;
      const regex = new RegExp(pattern.source, pattern.flags);
      
      while ((match = regex.exec(content)) !== null) {
        violations.push({
          pattern: name,
          match: this.maskMatch(match[0]),
        });
        
        if (!pattern.global) break;
      }
    }

    return {
      safe: violations.length === 0,
      violations,
    };
  }

  scanFile(file: { path: string; content: string }): FileScanResult {
    const violations: FileViolation[] = [];

    const pathResult = this.scan(file.path);
    for (const v of pathResult.violations) {
      violations.push({
        location: 'path',
        pattern: v.pattern,
        match: v.match,
      });
    }

    const contentResult = this.scan(file.content);
    const contentLines = file.content.split('\n');
    
    for (const v of contentResult.violations) {
      let lineNum = 1;
      for (let i = 0; i < contentLines.length; i++) {
        if (contentLines[i].includes(v.match.replace('****', '').substring(0, 6))) {
          lineNum = i + 1;
          break;
        }
      }
      violations.push({
        location: `content:line:${lineNum}`,
        pattern: v.pattern,
        match: v.match,
      });
    }

    return {
      safe: violations.length === 0,
      violations,
    };
  }

  scanObject(obj: Record<string, unknown>, depth: number = 0): ObjectScanResult {
    if (depth > 5) {
      return { safe: true, violations: [] };
    }

    const violations: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        const result = this.scan(value);
        for (const v of result.violations) {
          violations.push(`Object key "${key}": ${v.pattern} detected`);
        }
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const nested = this.scanObject(value as Record<string, unknown>, depth + 1);
        violations.push(...nested.violations);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') {
            const result = this.scan(item);
            for (const v of result.violations) {
              violations.push(`Array item: ${v.pattern} detected`);
            }
          } else if (typeof item === 'object' && item !== null) {
            const nested = this.scanObject(item as Record<string, unknown>, depth + 1);
            violations.push(...nested.violations);
          }
        }
      }
    }

    return {
      safe: violations.length === 0,
      violations,
    };
  }

  private maskMatch(match: string): string {
    if (match.length >= 6) {
      return match.substring(0, 6) + '****';
    }
    return '******';
  }
}

let globalLeakDetector: LeakDetector | null = null;

export function getLeakDetector(): LeakDetector {
  if (!globalLeakDetector) {
    globalLeakDetector = new LeakDetector();
  }
  return globalLeakDetector;
}
