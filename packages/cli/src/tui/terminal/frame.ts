// frame.ts — Frame builder.
// Assembles exactly H lines of exactly W visible characters.
// Output is one string joined by '\n' — written in a single stdout.write call.

import { fit, hRule, visibleWidth } from './text.js';
import { RESET, styled, DIM, FG } from './ansi.js';

export interface FrameOptions {
  width:  number;
  height: number;
}

export class Frame {
  private readonly lines: string[] = [];
  private readonly w: number;
  private readonly h: number;

  constructor({ width, height }: FrameOptions) {
    this.w = width;
    this.h = height;
  }

  // Add a single line — fitted to exact width.
  push(line: string): void {
    this.lines.push(fit(line, this.w));
  }

  // Add multiple pre-fitted lines.
  pushAll(lines: string[]): void {
    for (const l of lines) this.push(l);
  }

  // Add `n` blank lines.
  blank(n = 1): void {
    for (let i = 0; i < n; i++) this.lines.push(' '.repeat(this.w));
  }

  // Add a full-width horizontal rule.
  rule(ch = '─', style = ''): void {
    const plain = hRule(this.w, ch);
    this.lines.push(style ? fit(style + plain + RESET, this.w) : fit(plain, this.w));
  }

  // Add a section divider with label: ── LABEL ─────────────────
  labelRule(label: string, labelStyle = '', ruleStyle = ''): void {
    const prefix    = ruleStyle ? `${ruleStyle}── ${RESET}` : '── ';
    const prefixW   = 3;
    const styledLbl = labelStyle ? `${labelStyle}${label}${RESET}` : label;
    const lblW      = label.length;
    const spaceW    = 1;
    const remaining = Math.max(0, this.w - prefixW - lblW - spaceW);
    const suffix    = ruleStyle
      ? `${ruleStyle} ${'─'.repeat(remaining)}${RESET}`
      : ` ${'─'.repeat(remaining)}`;
    this.push(prefix + styledLbl + suffix);
  }

  // Number of lines added so far.
  get lineCount(): number  { return this.lines.length; }

  // Remaining lines until the frame is full.
  get remaining(): number  { return Math.max(0, this.h - this.lines.length); }

  // Width / height accessors.
  get width(): number      { return this.w; }
  get height(): number     { return this.h; }

  // Finalise: pad to exactly H lines, return as single string.
  finalize(): string {
    const result = this.lines.slice(0, this.h);
    while (result.length < this.h) result.push(' '.repeat(this.w));
    return result.join('\n');
  }
}
