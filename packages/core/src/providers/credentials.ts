import { ProviderConfig, ProviderCredentials } from "./types.js";
import { ExplainableError } from "../errors/ExplainableError.js";

export function resolveCredentials(provider: ProviderConfig): ProviderCredentials | null {
  const creds = provider.credentials;
  if (!creds) return null;

  const resolved: ProviderCredentials = {};

  if (creds.apiKey) {
    if (creds.apiKey.startsWith("env:")) {
      const envVar = creds.apiKey.replace("env:", "");
      const value = process.env[envVar];
      if (!value) {
        throw new ExplainableError({
          code: "CREDENTIAL_ENV_MISSING",
          title: `Missing Environment Variable`,
          message: `Provider '${provider.id}' expects credential from environment variable '${envVar}', but it's not set.`,
          fixes: [
            `Add to your .env file: ${envVar}=your_key_here`,
            `Or export it: export ${envVar}=your_key_here`,
            `Or set it inline in eamilos.yaml under credentials.apiKey`,
          ],
        });
      }
      resolved.apiKey = value;
    } else {
      resolved.apiKey = creds.apiKey;
    }
  }

  if (creds.token) {
    if (creds.token.startsWith("env:")) {
      const envVar = creds.token.replace("env:", "");
      resolved.token = process.env[envVar] || "";
    } else {
      resolved.token = creds.token;
    }
  }

  if (creds.headers) {
    resolved.headers = {};
    for (const [key, value] of Object.entries(creds.headers)) {
      if (typeof value === "string" && value.startsWith("env:")) {
        const envVar = value.replace("env:", "");
        resolved.headers[key] = process.env[envVar] || "";
      } else {
        resolved.headers[key] = value;
      }
    }
  }

  if (creds.organization) {
    resolved.organization = creds.organization;
  }

  return resolved;
}

export function isLocalUrl(url?: string): boolean {
  if (!url) return false;
  return (
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("0.0.0.0")
  );
}

export function buildAuthHeaders(credentials: ProviderCredentials | null): Record<string, string> {
  const headers: Record<string, string> = {};

  if (credentials?.apiKey) {
    headers["Authorization"] = `Bearer ${credentials.apiKey}`;
  }

  if (credentials?.token) {
    headers["Authorization"] = `Bearer ${credentials.token}`;
  }

  if (credentials?.headers) {
    Object.assign(headers, credentials.headers);
  }

  if (credentials?.organization) {
    headers["OpenAI-Organization"] = credentials.organization;
  }

  return headers;
}
