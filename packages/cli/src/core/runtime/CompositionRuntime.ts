import { BundleRuntime } from './BundleRuntime.js';
import { PluginRuntime } from './PluginRuntime.js';
import { ProfileRuntime, type RuntimeProfile, type CapabilityPreset } from './ProfileRuntime.js';
import { RuntimeInspector } from './RuntimeInspector.js';

export class CompositionRuntime {
  readonly profiles: ProfileRuntime;
  readonly bundles: BundleRuntime;
  readonly inspector: RuntimeInspector;

  constructor(readonly runtime: PluginRuntime) {
    this.profiles = new ProfileRuntime();
    this.bundles = new BundleRuntime(this.profiles);
    this.inspector = new RuntimeInspector(runtime, this.profiles, this.bundles);
  }

  registerProfile(profile: RuntimeProfile): () => void {
    return this.profiles.registerProfile(profile);
  }

  registerPreset(preset: CapabilityPreset): () => void {
    return this.profiles.registerPreset(preset);
  }
}
