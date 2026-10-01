import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BundleRuntime } from '../core/runtime/BundleRuntime.js';
import { CompositionRuntime } from '../core/runtime/CompositionRuntime.js';
import { ExternalPluginRuntime } from '../core/runtime/ExternalPluginRuntime.js';
import { PluginRuntime } from '../core/runtime/PluginRuntime.js';
import { ProfileRuntime } from '../core/runtime/ProfileRuntime.js';

describe('Phase D runtime composition', () => {
  it('resolves inherited profiles and presets deterministically', () => {
    const profiles = new ProfileRuntime();
    profiles.registerPreset({
      id: 'developer',
      description: 'Developer execution',
      capabilities: ['runtime.tools', 'runtime.terminal'],
    });
    profiles.registerProfile({
      id: 'base',
      version: '1',
      description: 'Base',
      capabilities: ['runtime.models'],
      presets: ['developer'],
    });
    profiles.registerProfile({
      id: 'headless',
      version: '1',
      description: 'Headless',
      extends: ['base'],
      capabilities: ['runtime.jobs'],
    });
    expect(profiles.resolve('headless').capabilities).toEqual([
      'runtime.jobs',
      'runtime.models',
      'runtime.terminal',
      'runtime.tools',
    ]);
  });

  it('rejects profile inheritance cycles', () => {
    const profiles = new ProfileRuntime();
    profiles.registerProfile({ id: 'a', version: '1', description: '', extends: ['b'] });
    profiles.registerProfile({ id: 'b', version: '1', description: '', extends: ['a'] });
    expect(() => profiles.resolve('a')).toThrow('inheritance cycle');
  });

  it('installs bundle plugins atomically', async () => {
    const runtime = new PluginRuntime();
    const profiles = new ProfileRuntime();
    profiles.registerProfile({
      id: 'minimal',
      version: '1',
      description: 'Minimal',
      plugins: ['provider', 'consumer'],
    });
    const bundles = new BundleRuntime(profiles);
    const answer = { id: 'answer' } as { id: string };
    bundles.register({
      id: 'test',
      version: '1',
      description: 'Test',
      profile: 'minimal',
      plugins: [
        { name: 'provider', provides: ['answer'], setup: ctx => { ctx.provide(answer, 42); } },
        { name: 'consumer', inject: ['answer'], setup: ctx => {
          if (ctx.resolve(answer) !== 42) throw new Error('wrong capability');
        }},
      ],
    });
    const dispose = await bundles.install(runtime, 'test');
    expect(runtime.listCapabilities().map(x => x.id)).toContain('answer');
    await dispose();
    expect(runtime.listCapabilities().map(x => x.id)).not.toContain('answer');
  });

  it('exposes runtime inspection', () => {
    const runtime = new PluginRuntime();
    const composition = new CompositionRuntime(runtime);
    composition.registerProfile({
      id: 'minimal',
      version: '1',
      description: 'Minimal',
      capabilities: ['runtime.tools'],
    });
    expect(composition.inspector.inspect().profiles.profiles.map(x => x.id)).toContain('minimal');
    expect(composition.inspector.toJSON()).toContain('dependencyGraph');
  });

  it('loads an external plugin through the same lifecycle contract', async () => {
    const runtime = new PluginRuntime();
    const external = new ExternalPluginRuntime(runtime);
    const dispose = await external.load({
      name: 'external-test',
      entry: './fixtures/external-plugin.mjs',
      provides: ['external.answer'],
    }, dirname(fileURLToPath(import.meta.url)));
    expect(runtime.dependencyGraph().nodes.some(x => x.id === 'plugin:external-test')).toBe(true);
    await dispose();
  });
});
