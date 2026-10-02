import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record).sort().reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonicalize(record[key]);
      return result;
    }, {});
  }
  return value;
}

export class ContextHasher {
  static hash(value: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(canonicalize(value)))
      .digest('hex');
  }
}
