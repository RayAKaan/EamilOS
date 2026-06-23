import path from "path";

export interface PathValidationResult {
  safe: boolean;
  normalizedPath: string;
  originalPath: string;
  rejectionReason?: string;
  rejectionRule?: string;
}

export class PathSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathSecurityError';
  }
}

export class PathValidator {

  private static readonly BLOCKED_FILENAMES: Set<string> = new Set([
    "data.json",
    "output.txt",
    "file.txt",
    "untitled",
    "response.json",
    "result.json",
    "output.json",
    "temp.txt",
    "example.txt",
    "test.txt",
    "sample.txt",
    "demo.txt",

    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    ".env.staging",
    ".env.test",

    "id_rsa",
    "id_rsa.pub",
    "id_ed25519",
    "id_ed25519.pub",
    ".npmrc",
    ".pypirc",
    ".netrc",
    ".pgpass",
    "credentials.json",
    "service-account.json",
    "keyfile.json",

    ".git",
    ".gitconfig",

    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "gemfile.lock",
    "composer.lock",

    ".ds_store",
    "thumbs.db",
    "desktop.ini",

    "node_modules",
  ]);

  private static readonly BLOCKED_PATTERNS: RegExp[] = [
    /^\.env\b/i,
    /^\.git\b/i,
    /secret/i,
    /credential/i,
    /password/i,
    /private[_-]?key/i,
  ];

  private static readonly ALLOWED_DESPITE_PATTERN: Set<string> = new Set([
    ".gitignore",
    ".gitattributes",
    ".gitkeep",
    ".github",
  ]);

  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  validate(filePath: string): PathValidationResult {
    const original = filePath;

    if (!filePath || typeof filePath !== "string" || filePath.trim() === "") {
      return this.reject(original, "", "EMPTY_PATH",
        "File path is empty or whitespace-only");
    }

    let normalized = this.normalizePath(filePath);

    if (this.isAbsolutePath(original) || this.isAbsolutePath(normalized)) {
      return this.reject(original, normalized, "ABSOLUTE_PATH",
        "Absolute paths are forbidden. Use relative paths only. Got: " + original);
    }

    if (this.hasTraversal(original) || this.hasTraversal(normalized)) {
      return this.reject(original, normalized, "PATH_TRAVERSAL",
        "Path traversal sequences (..) are forbidden. Got: " + original);
    }

    const resolved = path.resolve(this.workspaceRoot, normalized);
    if (!resolved.startsWith(this.workspaceRoot + path.sep) &&
        resolved !== this.workspaceRoot) {
      return this.reject(original, normalized, "WORKSPACE_ESCAPE",
        "Resolved path escapes workspace boundary. " +
        "Workspace: " + this.workspaceRoot + " | " +
        "Resolved: " + resolved);
    }

    const dangerousChars = /[<>"|?*\x00-\x1F]/;
    if (dangerousChars.test(normalized)) {
      return this.reject(original, normalized, "DANGEROUS_CHARACTERS",
        "Path contains characters that are unsafe for filesystems: " +
        original.replace(/[\x00-\x1F]/g, "[CTRL]"));
    }

    if (/[\u0000-\u001F\u007F-\u009F]/.test(normalized)) {
      return this.reject(original, normalized, "CONTROL_CHARACTERS",
        "Path contains invisible control characters that are unsafe");
    }

    const bidiChars = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
    if (bidiChars.test(normalized)) {
      return this.reject(original, normalized, "BIDI_OVERRIDE",
        "Path contains Unicode bidirectional override characters (potential attack)");
    }

    const zeroWidth = /[\u200B\u200C\u200D\uFEFF]/;
    if (zeroWidth.test(normalized)) {
      return this.reject(original, normalized, "ZERO_WIDTH_CHARS",
        "Path contains invisible zero-width characters");
    }

    const basename = path.basename(normalized).split(".")[0].toUpperCase();
    const windowsReserved = [
      "CON", "PRN", "AUX", "NUL",
      "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
      "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
    ];
    if (windowsReserved.includes(basename)) {
      return this.reject(original, normalized, "WINDOWS_RESERVED_NAME",
        "'" + basename + "' is a Windows reserved device name and cannot be used");
    }

    const blockCheck = PathValidator.isBlockedFilenameStatic(normalized);
    if (blockCheck.blocked) {
      return this.reject(original, normalized, "BLOCKED_FILENAME", blockCheck.reason);
    }

    if (normalized.length > 260) {
      return this.reject(original, normalized, "PATH_TOO_LONG",
        "Path exceeds 260 characters (" + normalized.length + " chars)");
    }

    const segments = normalized.split("/").filter(s => s.length > 0);
    for (const segment of segments) {
      if (/^\.+$/.test(segment)) {
        return this.reject(original, normalized, "DOT_SEGMENT",
          "Path segment '" + segment + "' is not allowed");
      }
    }

    return {
      safe: true,
      normalizedPath: normalized,
      originalPath: original
    };
  }

  private normalizePath(p: string): string {
    return p
      .normalize("NFC")
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/$/, "");
  }

  private isAbsolutePath(p: string): boolean {
    if (p.startsWith("/")) return true;
    if (/^[a-zA-Z]:[\\\/]/.test(p)) return true;
    if (p.startsWith("\\\\")) return true;
    if (path.isAbsolute(p)) return true;
    return false;
  }

  private hasTraversal(p: string): boolean {
    const normalized = p.replace(/\\/g, "/");
    if (normalized.includes("..")) return true;
    return false;
  }

  private reject(
    original: string,
    normalized: string,
    rule: string,
    reason: string
  ): PathValidationResult {
    return {
      safe: false,
      normalizedPath: normalized,
      originalPath: original,
      rejectionReason: reason,
      rejectionRule: rule
    };
  }

  static isBlockedFilenameStatic(filePath: string): { blocked: boolean; reason: string } {
    const normalized = filePath.trim().toLowerCase();
    const basename = normalized.split("/").pop() || normalized;

    if (PathValidator.ALLOWED_DESPITE_PATTERN.has(basename)) {
      return { blocked: false, reason: "" };
    }

    if (PathValidator.BLOCKED_FILENAMES.has(basename)) {
      return {
        blocked: true,
        reason: "BLOCKED_FILENAME: '" + filePath + "' is not allowed " +
                "(matched blocked name '" + basename + "')"
      };
    }

    if (PathValidator.BLOCKED_FILENAMES.has(normalized)) {
      return {
        blocked: true,
        reason: "BLOCKED_PATH: '" + filePath + "' matches blocked path"
      };
    }

    for (const pattern of PathValidator.BLOCKED_PATTERNS) {
      if (pattern.test(basename) || pattern.test(normalized)) {
        return {
          blocked: true,
          reason: "BLOCKED_PATTERN: '" + filePath + "' matches security pattern " +
                  pattern.toString()
        };
      }
    }

    return { blocked: false, reason: "" };
  }

  static isBlockedFilename(filePath: string): { blocked: boolean; reason: string } {
    return PathValidator.isBlockedFilenameStatic(filePath);
  }
}
