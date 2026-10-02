import { describe, expect, it } from 'vitest';
import { UNIVERSAL_AGENT_CATALOG } from '../agents/universal/catalog.js';
import { UniversalAgentRegistry } from '../agents/universal/UniversalAgentRegistry.js';
import { createUniversalHarnessAdapters } from './UniversalHarnessAdapter.js';
import { HarnessRegistry } from './HarnessRegistry.js';

describe('Universal execution fabric', () => {
  it('exposes every Phase 1 worker through the normalized harness contract', () => {
    const registry = new UniversalAgentRegistry();
    const adapters = createUniversalHarnessAdapters(registry);
    expect(UNIVERSAL_AGENT_CATALOG).toHaveLength(35);
    expect(adapters).toHaveLength(35);
    expect(new Set(adapters.map((adapter) => adapter.descriptor.id)).size).toBe(35);
    for (const adapter of adapters) {
      expect(adapter.descriptor.supportedModes).toContain('execution');
      expect(adapter.descriptor.capabilities.execution).toBe(true);
      expect(adapter.descriptor.command).toBeTruthy();
    }
  });

  it('uses the universal fleet as the runtime harness registry', () => {
    const registry = new HarnessRegistry();
    expect(registry.list()).toHaveLength(35);
    expect(registry.list().map((item) => item.id).sort()).toEqual(
      UNIVERSAL_AGENT_CATALOG.map((item) => item.id).sort(),
    );
  });
});
