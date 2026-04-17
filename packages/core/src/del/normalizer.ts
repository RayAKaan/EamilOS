import { createHash } from 'crypto';
import { NormalizedOutput, OutputFormat } from './stateful-types.js';

export interface NormalizationResult {
  output: NormalizedOutput;
  hash: string;
}

const ANSI_ESCAPE_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function sanitize(raw: string): string {
  let sanitized = raw;

  sanitized = sanitized.replace(ANSI_ESCAPE_REGEX, '');
  sanitized = sanitized.replace(CONTROL_CHARS_REGEX, '');

  sanitized = sanitized.replace(/\r\n/g, '\n');
  sanitized = sanitized.replace(/\r/g, '\n');

  sanitized = sanitized.replace(/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g, ' ');
  sanitized = sanitized.replace(/\t/g, '  ');

  sanitized = sanitized.replace(/\uFEFF/g, '');
  sanitized = sanitized.replace(/\uFFFE/g, '');

  sanitized = sanitized.replace(/^[\s\r\n]+|[\s\r\n]+$/g, '');

  sanitized = sanitized.replace(/(?<!\n)\n{3,}/g, '\n\n');

  return sanitized;
}

function detectFormat(sanitized: string): OutputFormat {
  const trimmed = sanitized.trim();

  if (/^```(?:json)?\s*[\[\{]/.test(trimmed)) {
    return 'markdown';
  }

  if (/^[\[\{]/.test(trimmed)) {
    return 'json';
  }

  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlockMatch) {
    try {
      JSON.parse(jsonBlockMatch[1]);
      return 'markdown';
    } catch {
    }
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace && lastBrace - firstBrace < trimmed.length * 0.8) {
    const candidate = trimmed.substring(firstBrace, lastBrace + 1);
    try {
      JSON.parse(candidate);
      return 'fragment';
    } catch {
    }
  }

  const codeBlockCount = (trimmed.match(/```[\s\S]*?```/g) || []).length;
  if (codeBlockCount > 0) {
    return 'markdown';
  }

  return 'text';
}

function detectProviders(sanitized: string): string[] {
  const providers: string[] = [];

  if (/```(?:json)?\s*[\[\{]/.test(sanitized)) {
    providers.push('code-block');
  }

  if (/^\s*[\[\{]/.test(sanitized.trim())) {
    providers.push('raw-json');
  }

  const firstBrace = sanitized.indexOf('{');
  if (firstBrace > 0 && firstBrace < 200) {
    const beforeBrace = sanitized.substring(0, firstBrace).toLowerCase();
    if (/here('s| is)|below|following|example/i.test(beforeBrace)) {
      providers.push('conversational-prefix');
    }
  }

  const conversationalPrefixes = [
    /^sure,?\s*/i,
    /^here('s| is| are)/i,
    /^below/i,
    /^the following/i,
    /^(yes,?|ok,?)\s+(here('s| is)|i('ll| will)?\s*(give|provide))/i,
    /^as requested/i,
    /^to (do|create|implement)/i,
  ];

  const trimmed = sanitized.trim();
  for (const prefix of conversationalPrefixes) {
    if (prefix.test(trimmed)) {
      providers.push('conversational');
      break;
    }
  }

  if (providers.length === 0) {
    providers.push('unknown');
  }

  return providers;
}

export function normalize(raw: string): NormalizationResult {
  const sanitized = sanitize(raw);
  const format = detectFormat(sanitized);
  const detectedProviders = detectProviders(sanitized);

  const hash = createHash('sha256').update(sanitized, 'utf-8').digest('hex');

  const output: NormalizedOutput = {
    raw,
    sanitized,
    format,
    detectedProviders,
  };

  return { output, hash };
}

export function stripConversationalPrefix(sanitized: string): string {
  const patterns = [
    /^(?:sure,?|yes,?|ok,?|no,?)\s*(here('s| is| are)|i('ll| will)?\s*(give|provide|share)|the following)[\s:]+/i,
    /^here('s| is| are)[\s:]+/i,
    /^below[\s:]+/i,
    /^the following[\s:]+/i,
    /^as requested[\s:]+/i,
    /^to (do|create|implement)[\s:]+/i,
    /^(?:note|tip|important)[\s:]+/i,
  ];

  let result = sanitized;
  for (const pattern of patterns) {
    result = result.replace(pattern, '');
  }

  return result.trim();
}

export function hasFormatIndicators(sanitized: string): boolean {
  return /```|^\s*[\[\{]/m.test(sanitized);
}
