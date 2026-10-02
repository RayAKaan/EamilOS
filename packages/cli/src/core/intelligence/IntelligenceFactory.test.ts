import { describe, expect, it } from 'vitest';
import { createIntelligenceRuntime } from './IntelligenceFactory.js';

describe('Phase 1 intelligence independence', () => {
  it('does not require Jev or Laya environment variables to construct the runtime', () => {
    const oldJevUrl = process.env.EAMILOS_JEV_URL;
    const oldJevKey = process.env.EAMILOS_JEV_API_KEY;
    const oldLaya = process.env.EAMILOS_LAYA_COMMAND;
    delete process.env.EAMILOS_JEV_URL;
    delete process.env.EAMILOS_JEV_API_KEY;
    delete process.env.EAMILOS_LAYA_COMMAND;
    try {
      expect(() => createIntelligenceRuntime()).not.toThrow();
    } finally {
      if (oldJevUrl === undefined) delete process.env.EAMILOS_JEV_URL; else process.env.EAMILOS_JEV_URL = oldJevUrl;
      if (oldJevKey === undefined) delete process.env.EAMILOS_JEV_API_KEY; else process.env.EAMILOS_JEV_API_KEY = oldJevKey;
      if (oldLaya === undefined) delete process.env.EAMILOS_LAYA_COMMAND; else process.env.EAMILOS_LAYA_COMMAND = oldLaya;
    }
  });
});
