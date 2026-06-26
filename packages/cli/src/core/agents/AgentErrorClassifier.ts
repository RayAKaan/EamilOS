import type { AgentErrorType } from './types.js';

const ERROR_PATTERNS: Array<{ type: AgentErrorType; patterns: RegExp[] }> = [
  {
    type: 'rate_limited',
    patterns: [
      /rate\s*limit/i,
      /too\s*many\s*requests/i,
      /429/i,
      /retry\s*after/i,
      /slow\s*down/i,
      /please\s*wait/i,
    ],
  },
  {
    type: 'quota_exceeded',
    patterns: [
      /quota\s*exceeded/i,
      /insufficient\s*quota/i,
      /exceeded\s*your\s*(current|monthly|daily)/i,
      /usage\s*limit/i,
      /billing\s*limit/i,
      /credit\s*balance/i,
    ],
  },
  {
    type: 'token_limit',
    patterns: [
      /context\s*length\s*exceeded/i,
      /maximum\s*context/i,
      /token\s*limit/i,
      /max\s*tokens/i,
      /too\s*many\s*tokens/i,
      /input\s*too\s*long/i,
      /exceeded\s*maximum\s*length/i,
    ],
  },
  {
    type: 'auth_missing',
    patterns: [
      /not\s*logged\s*in/i,
      /login\s*required/i,
      /authentication\s*required/i,
      /no\s*api\s*key/i,
      /api.key\s*not\s*(found|set|configured)/i,
      /missing\s*credentials/i,
      /not\s*authenticated/i,
      /unauthenticated/i,
      /sign\s*in/i,
    ],
  },
  {
    type: 'auth_failed',
    patterns: [
      /authentication\s*failed/i,
      /invalid\s*api\s*key/i,
      /unauthorized/i,
      /403/i,
      /401/i,
      /permission\s*denied/i,
      /access\s*denied/i,
      /invalid\s*credentials/i,
      /auth\s*error/i,
    ],
  },
  {
    type: 'not_installed',
    patterns: [
      /command\s*not\s*found/i,
      /not\s*installed/i,
      /cannot\s*find/i,
      /no\s*such\s*file/i,
      /is\s*not\s*recognized/i,
      /spawn\s*.*\s*enoent/i,
      /not\s*found/i,
    ],
  },
  {
    type: 'timeout',
    patterns: [
      /timed?\s*out/i,
      /timeout/i,
      /request\s*took\s*too\s*long/i,
      /did\s*not\s*respond/i,
      /connection\s*timed?\s*out/i,
      /ETIMEDOUT/i,
      /ESOCKETTIMEDOUT/i,
    ],
  },
  {
    type: 'invalid_output',
    patterns: [
      /invalid\s*output/i,
      /unexpected\s*output/i,
      /failed\s*to\s*parse/i,
      /malformed/i,
      /invalid\s*json/i,
      /unexpected\s*token/i,
      /syntax\s*error/i,
    ],
  },
  {
    type: 'crash',
    patterns: [
      /segmentation\s*fault/i,
      /abort/i,
      /panic/i,
      /out\s*of\s*memory/i,
      /internal\s*error/i,
      /unhandled\s*rejection/i,
      /fatal/i,
      /stack\s*trace/i,
      /core\s*dumped/i,
    ],
  },
];

export function classifyAgentError(stderr: string, stdout?: string): AgentErrorType {
  const combined = `${stderr} ${stdout || ''}`;

  for (const entry of ERROR_PATTERNS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(combined)) {
        return entry.type;
      }
    }
  }

  if (stderr && stderr.length > 0) return 'crash';
  return 'unknown';
}

export function isRetryable(errorType: AgentErrorType): boolean {
  switch (errorType) {
    case 'rate_limited':
    case 'timeout':
    case 'quota_exceeded':
      return true;
    default:
      return false;
  }
}

export function isFallbackTrigger(errorType: AgentErrorType): boolean {
  switch (errorType) {
    case 'auth_missing':
    case 'auth_failed':
    case 'not_installed':
    case 'quota_exceeded':
    case 'crash':
      return true;
    default:
      return false;
  }
}
