import { createHash } from 'crypto';

export interface HashResult {
  hash: string;
  algorithm: string;
  length: number;
}

export function computeHash(content: string, algorithm: 'sha256' | 'sha1' | 'md5' = 'sha256'): HashResult {
  const hash = createHash(algorithm);
  hash.update(content, 'utf-8');
  const digest = hash.digest('hex');

  return {
    hash: digest,
    algorithm,
    length: digest.length,
  };
}

export function computeSha256(content: string): string {
  return computeHash(content, 'sha256').hash;
}

export function computeSha1(content: string): string {
  return computeHash(content, 'sha1').hash;
}

export function computeMd5(content: string): string {
  return computeHash(content, 'md5').hash;
}

export function verifyHash(content: string, expectedHash: string, algorithm: 'sha256' | 'sha1' | 'md5' = 'sha256'): boolean {
  const actual = computeHash(content, algorithm);
  return actual.hash === expectedHash;
}

export function computeFileHash(chunks: string[]): string {
  const hash = createHash('sha256');
  for (const chunk of chunks) {
    hash.update(chunk, 'utf-8');
  }
  return hash.digest('hex');
}

export function computePartialHash(content: string, prefixLength: number = 8): string {
  return computeSha256(content).substring(0, prefixLength);
}

export function isValidHash(hash: string, algorithm: 'sha256' | 'sha1' | 'md5' = 'sha256'): boolean {
  const expectedLengths: Record<string, number> = {
    sha256: 64,
    sha1: 40,
    md5: 32,
  };

  const expectedLength = expectedLengths[algorithm];
  if (!expectedLength) return false;

  if (hash.length !== expectedLength) return false;

  return /^[a-fA-F0-9]+$/.test(hash);
}

export function areHashesEqual(hash1: string, hash2: string): boolean {
  const normalize = (h: string) => h.toLowerCase().trim();
  return normalize(hash1) === normalize(hash2);
}
