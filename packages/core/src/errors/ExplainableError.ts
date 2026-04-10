export type ErrorSeverity = "fatal" | "warning" | "info";

export interface ExplainableErrorOptions {
  code: string;
  title: string;
  message: string;
  severity?: ErrorSeverity;
  fixes: string[];
  details?: unknown;
  docsUrl?: string;
}

export class ExplainableError extends Error {
  code: string;
  severity: ErrorSeverity;
  title: string;
  fixes: string[];
  details?: unknown;
  docsUrl?: string;

  constructor(options: ExplainableErrorOptions) {
    super(options.message);
    this.name = "ExplainableError";
    this.code = options.code;
    this.title = options.title;
    this.severity = options.severity || "fatal";
    this.fixes = options.fixes;
    this.details = options.details;
    this.docsUrl = options.docsUrl;
    Error.captureStackTrace(this, this.constructor);
  }

  render(): string {
    const width = 60;
    const border = "─".repeat(width - 2);
    const lines: string[] = [];

    const icon = this.severity === "fatal" ? "✖" : this.severity === "warning" ? "⚠" : "ℹ";
    const color = this.severity === "fatal" ? "red" : this.severity === "warning" ? "yellow" : "blue";

    lines.push(`\x1b[${getAnsiCode(color, "bold")}╭${border}╮\x1b[0m`);

    const titleLine = ` ${icon} ${this.title} `;
    lines.push(`\x1b[${getAnsiCode(color, "bold")}│\x1b[0m${" ".repeat(width - 2 - 2 - this.title.length - 4)}\x1b[${getAnsiCode(color, "bold")}${titleLine}\x1b[0m\x1b[${getAnsiCode(color, "bold")}│\x1b[0m`);

    lines.push(`\x1b[${getAnsiCode(color, "dim")}├${border}┤\x1b[0m`);

    const messageLines = wrapText(this.message, width - 4);
    for (const line of messageLines) {
      lines.push(`\x1b[${getAnsiCode(color)}│\x1b[0m  ${line.padEnd(width - 4)}\x1b[${getAnsiCode(color)}│\x1b[0m`);
    }

    lines.push(`\x1b[${getAnsiCode(color)}│\x1b[0m${" ".repeat(width - 2)}\x1b[${getAnsiCode(color)}│\x1b[0m`);

    if (this.fixes.length > 0) {
      lines.push(`\x1b[${getAnsiCode(color, "bold")}│\x1b[0m  How to fix:\x1b[${getAnsiCode(color)}│\x1b[0m`);
      for (let i = 0; i < this.fixes.length; i++) {
        const fixLine = `${i + 1}. ${this.fixes[i]}`;
        const wrappedFix = wrapText(fixLine, width - 4);
        for (const line of wrappedFix) {
          lines.push(`\x1b[${getAnsiCode(color)}│\x1b[0m  ${line.padEnd(width - 4)}\x1b[${getAnsiCode(color)}│\x1b[0m`);
        }
      }
    }

    if (this.docsUrl) {
      lines.push(`\x1b[${getAnsiCode(color)}│\x1b[0m${" ".repeat(width - 2)}\x1b[${getAnsiCode(color)}│\x1b[0m`);
      lines.push(`\x1b[${getAnsiCode(color, "dim")}│\x1b[0m  Docs: ${this.docsUrl}\x1b[${getAnsiCode(color)}│\x1b[0m`);
    }

    lines.push(`\x1b[${getAnsiCode(color, "dim")}╰${border}╯\x1b[0m\n`);

    return lines.join("\n");
  }

  toString(): string {
    return this.render();
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      severity: this.severity,
      title: this.title,
      message: this.message,
      fixes: this.fixes,
      details: this.details,
      docsUrl: this.docsUrl,
    };
  }
}

function getAnsiCode(color: string, style?: string): string {
  const codes: Record<string, string> = {
    red: "31",
    yellow: "33",
    blue: "34",
    dim: "2",
    bold: "1",
  };

  if (style && codes[style]) {
    return codes[style];
  }
  if (codes[color]) {
    return codes[color];
  }
  return "0";
}

function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxWidth) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

export function isExplainableError(error: unknown): error is ExplainableError {
  return error instanceof ExplainableError;
}

export function wrapError(error: unknown, code: string, title: string, fixes: string[]): ExplainableError {
  if (error instanceof ExplainableError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new ExplainableError({
    code,
    title,
    message,
    fixes,
    details: error instanceof Error ? { stack: error.stack } : undefined,
  });
}
