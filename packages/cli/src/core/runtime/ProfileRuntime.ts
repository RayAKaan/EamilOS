export interface CapabilityPreset {
  readonly id: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly denied?: readonly string[];
}

export interface RuntimeProfile {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly capabilities?: readonly string[];
  readonly plugins?: readonly string[];
  readonly presets?: readonly string[];
  readonly extends?: readonly string[];
}

export interface ResolvedProfile {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly capabilities: string[];
  readonly plugins: string[];
  readonly presets: CapabilityPreset[];
}

export class ProfileRuntime {
  private readonly profiles = new Map<string, RuntimeProfile>();
  private readonly presets = new Map<string, CapabilityPreset>();

  registerProfile(profile: RuntimeProfile): () => void {
    if (this.profiles.has(profile.id)) throw new Error(`Profile already registered: ${profile.id}`);
    this.profiles.set(profile.id, profile);
    return () => this.profiles.delete(profile.id);
  }

  registerPreset(preset: CapabilityPreset): () => void {
    if (this.presets.has(preset.id)) throw new Error(`Preset already registered: ${preset.id}`);
    this.presets.set(preset.id, preset);
    return () => this.presets.delete(preset.id);
  }

  resolve(id: string): ResolvedProfile {
    const visiting = new Set<string>();
    const resolveOne = (profileId: string): ResolvedProfile => {
      if (visiting.has(profileId)) throw new Error(`Profile inheritance cycle: ${[...visiting, profileId].join(' -> ')}`);
      const profile = this.profiles.get(profileId);
      if (!profile) throw new Error(`Unknown runtime profile: ${profileId}`);
      visiting.add(profileId);
      const capabilities = new Set<string>();
      const plugins = new Set<string>();
      const presets = new Map<string, CapabilityPreset>();

      for (const parent of profile.extends ?? []) {
        const resolved = resolveOne(parent);
        resolved.capabilities.forEach(v => capabilities.add(v));
        resolved.plugins.forEach(v => plugins.add(v));
        resolved.presets.forEach(v => presets.set(v.id, v));
      }
      profile.capabilities?.forEach(v => capabilities.add(v));
      profile.plugins?.forEach(v => plugins.add(v));
      for (const presetId of profile.presets ?? []) {
        const preset = this.presets.get(presetId);
        if (!preset) throw new Error(`Profile ${profileId} references unknown preset: ${presetId}`);
        presets.set(preset.id, preset);
        preset.capabilities.forEach(v => capabilities.add(v));
        preset.denied?.forEach(v => capabilities.delete(v));
      }
      visiting.delete(profileId);
      return {
        id: profile.id,
        version: profile.version,
        description: profile.description,
        capabilities: [...capabilities].sort(),
        plugins: [...plugins].sort(),
        presets: [...presets.values()].sort((a, b) => a.id.localeCompare(b.id)),
      };
    };
    return resolveOne(id);
  }

  listProfiles(): RuntimeProfile[] {
    return [...this.profiles.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  listPresets(): CapabilityPreset[] {
    return [...this.presets.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  catalog(): { profiles: RuntimeProfile[]; presets: CapabilityPreset[] } {
    return { profiles: this.listProfiles(), presets: this.listPresets() };
  }
}
