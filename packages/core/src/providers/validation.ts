import { ProviderConfig, ProviderIssue } from "./types.js";
import { isLocalUrl } from "./credentials.js";

export interface ValidationResult {
  valid: boolean;
  issues: ProviderIssue[];
}

export function validateCredentials(provider: ProviderConfig): ValidationResult {
  const issues: ProviderIssue[] = [];

  if (provider.type === "local") {
    return { valid: true, issues: [] };
  }

  const creds = provider.credentials;

  if (!creds || (!creds.apiKey && !creds.token && !creds.headers)) {
    if (provider.type === "openai-compatible" && isLocalUrl(provider.baseUrl)) {
      return { valid: true, issues: [] };
    }

    issues.push({
      severity: "fatal",
      code: "NO_CREDENTIALS",
      message: `No credentials found for provider '${provider.id}'`,
      fix: [
        `Add credentials in eamilos.yaml:`,
        `  credentials:`,
        `    apiKey: env:${provider.id.toUpperCase().replace(/-/g, "_")}_API_KEY`,
        ``,
        `Then add to your .env file:`,
        `  ${provider.id.toUpperCase().replace(/-/g, "_")}_API_KEY=your_key_here`,
      ],
      autoFixable: false,
    });
    return { valid: false, issues };
  }

  if (creds.apiKey) {
    const formatIssue = validateKeyFormat(provider.engine, creds.apiKey);
    if (formatIssue) {
      issues.push(formatIssue);
    }
  }

  return {
    valid: issues.filter((i) => i.severity === "fatal").length === 0,
    issues,
  };
}

export function validateKeyFormat(
  engine: string | undefined,
  key: string
): ProviderIssue | null {
  const patterns: Record<string, { prefix: string; hint: string }> = {
    openai: { prefix: "sk-", hint: "OpenAI keys typically start with 'sk-'" },
    anthropic: {
      prefix: "sk-ant-",
      hint: "Anthropic keys typically start with 'sk-ant-'",
    },
    google: { prefix: "AI", hint: "Google API keys typically start with 'AI'" },
  };

  const pattern = patterns[engine || ""];
  if (pattern && !key.startsWith(pattern.prefix)) {
    return {
      severity: "warning",
      code: "CREDENTIAL_FORMAT_WARNING",
      message: `API key for '${engine}' has unexpected format. ${pattern.hint}`,
      fix: [
        `Verify your key is correct. This is just a format warning — it may still work.`,
      ],
      autoFixable: false,
    };
  }

  if (key.length < 10) {
    return {
      severity: "warning",
      code: "CREDENTIAL_TOO_SHORT",
      message: `API key seems too short (${key.length} chars). Most API keys are 30+ characters.`,
      fix: [`Double-check your API key is complete and not truncated.`],
      autoFixable: false,
    };
  }

  return null;
}
