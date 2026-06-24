import { describe, it, expect } from 'vitest';
import { ConflictArbiter } from '../core/comms/ConflictArbiter.js';

describe('ConflictArbiter', () => {
  it('should compute consistent sha256 hashes', () => {
    const hash1 = ConflictArbiter.computeHash('Alpha', 'auth.ts', 'const a = 1;');
    const hash2 = ConflictArbiter.computeHash('Alpha', 'auth.ts', 'const a = 1;');
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });

  it('should compute different hashes for different callsigns or contents', () => {
    const hash1 = ConflictArbiter.computeHash('Alpha', 'auth.ts', 'const a = 1;');
    const hash2 = ConflictArbiter.computeHash('Beta', 'auth.ts', 'const a = 1;');
    expect(hash1).not.toBe(hash2);
  });
});
