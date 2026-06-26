const BASE_SAFE_ENV = [
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'SHELL',
  'TERM',
  'TMPDIR',
  'TEMP',
  'TMP',
  'NO_COLOR',
  'LANG',
  'LC_ALL',
];

const PROVIDER_ENV_BY_AGENT: Record<string, string[]> = {
  'claude-code': ['ANTHROPIC_API_KEY'],
  'gemini-cli': ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  'gemini': ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  'codex-cli': ['OPENAI_API_KEY'],
  'opencode': ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'OLLAMA_HOST'],
  'ollama': ['OLLAMA_HOST'],
  'aider': ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'],
  'goose': ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY'],
  'eamilos': ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OLLAMA_HOST'],
};

export function buildAgentEnv(agentId: string, extra?: Record<string, string>): Record<string, string> {
  const allowed = new Set<string>([
    ...BASE_SAFE_ENV,
    ...(PROVIDER_ENV_BY_AGENT[agentId] ?? []),
  ]);

  const env: Record<string, string> = {
    NO_COLOR: 'true',
  };

  for (const key of allowed) {
    const val = process.env[key];
    if (val) {
      env[key] = val;
    }
  }

  if (extra) {
    for (const [key, val] of Object.entries(extra)) {
      env[key] = val;
    }
  }

  return env;
}

export function buildSafeEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {
    NO_COLOR: 'true',
  };

  for (const key of BASE_SAFE_ENV) {
    const val = process.env[key];
    if (val) {
      env[key] = val;
    }
  }

  if (extra) {
    for (const [key, val] of Object.entries(extra)) {
      env[key] = val;
    }
  }

  return env;
}
