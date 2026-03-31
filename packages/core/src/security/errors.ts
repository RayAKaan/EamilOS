export class SecretNotFoundError extends Error {
  constructor(key: string) {
    super(`Secret '${key}' not found. Set it as an environment variable or run: eamilos init`);
    this.name = 'SecretNotFoundError';
  }
}

export class SecretValidationError extends Error {
  constructor(key: string, format: string, error: string) {
    super(`Secret '${key}' validation failed (expected ${format}): ${error}`);
    this.name = 'SecretValidationError';
  }
}
