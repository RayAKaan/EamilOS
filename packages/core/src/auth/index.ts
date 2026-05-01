import { Profile, Role } from './types.js';
import { nanoid } from 'nanoid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export class ProfileManager {
  private profilesDir: string;
  private profiles: Map<string, Profile> = new Map();
  private activeProfileId: string | null = null;

  constructor(profilesDir?: string) {
    this.profilesDir = profilesDir || path.join(os.homedir(), '.eamilos', 'profiles');
    this.ensureDir();
    this.loadProfiles();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.profilesDir)) {
      fs.mkdirSync(this.profilesDir, { recursive: true });
    }
  }

  private profileFilePath(id: string): string {
    return path.join(this.profilesDir, `${id}.json`);
  }

  private activeProfileFilePath(): string {
    return path.join(this.profilesDir, '.active');
  }

  private loadProfiles(): void {
    this.profiles.clear();
    if (!fs.existsSync(this.profilesDir)) return;

    const files = fs.readdirSync(this.profilesDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = fs.readFileSync(path.join(this.profilesDir, file), 'utf-8');
        const profile = JSON.parse(data) as Profile;
        this.profiles.set(profile.id, profile);
      } catch {
        // Skip corrupted files
      }
    }

    if (fs.existsSync(this.activeProfileFilePath())) {
      try {
        const activeId = fs.readFileSync(this.activeProfileFilePath(), 'utf-8').trim();
        if (this.profiles.has(activeId)) {
          this.activeProfileId = activeId;
        }
      } catch {
        // Ignore
      }
    }
  }

  private saveProfile(profile: Profile): void {
    fs.writeFileSync(this.profileFilePath(profile.id), JSON.stringify(profile, null, 2), 'utf-8');
    this.profiles.set(profile.id, profile);
  }

  createProfile(name: string, email: string): Profile {
    const profile: Profile = {
      id: nanoid(12),
      name,
      userId: crypto.randomUUID(),
      email,
      createdAt: Date.now(),
      lastActive: Date.now(),
      teamId: null,
      role: 'owner',
    };

    this.saveProfile(profile);

    if (!this.activeProfileId) {
      this.setActiveProfile(profile.id);
    }

    return profile;
  }

  getProfile(id: string): Profile | undefined {
    return this.profiles.get(id);
  }

  getActiveProfile(): Profile | undefined {
    if (!this.activeProfileId) return undefined;
    return this.profiles.get(this.activeProfileId);
  }

  setActiveProfile(id: string): boolean {
    if (!this.profiles.has(id)) return false;
    this.activeProfileId = id;
    fs.writeFileSync(this.activeProfileFilePath(), id, 'utf-8');
    const profile = this.profiles.get(id)!;
    profile.lastActive = Date.now();
    this.saveProfile(profile);
    return true;
  }

  listProfiles(): Profile[] {
    return Array.from(this.profiles.values()).sort((a, b) => b.lastActive - a.lastActive);
  }

  deleteProfile(id: string): boolean {
    const profile = this.profiles.get(id);
    if (!profile) return false;

    const filePath = this.profileFilePath(id);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    this.profiles.delete(id);

    if (this.activeProfileId === id) {
      this.activeProfileId = this.profiles.size > 0 ? Array.from(this.profiles.keys())[0] : null;
      if (this.activeProfileId) {
        fs.writeFileSync(this.activeProfileFilePath(), this.activeProfileId, 'utf-8');
      } else if (fs.existsSync(this.activeProfileFilePath())) {
        fs.unlinkSync(this.activeProfileFilePath());
      }
    }

    return true;
  }

  joinTeam(profileId: string, teamId: string, role: Role): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) return false;

    profile.teamId = teamId;
    profile.role = role;
    this.saveProfile(profile);
    return true;
  }

  leaveTeam(profileId: string): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) return false;

    profile.teamId = null;
    profile.role = 'owner';
    this.saveProfile(profile);
    return true;
  }

  getProfileCount(): number {
    return this.profiles.size;
  }

  exportProfileData(profileId: string): string | null {
    const profile = this.profiles.get(profileId);
    if (!profile) return null;

    return JSON.stringify({
      profile,
      exportedAt: Date.now(),
      version: '1.0',
    }, null, 2);
  }

  deleteProfileData(profileId: string): boolean {
    return this.deleteProfile(profileId);
  }
}

let globalProfileManager: ProfileManager | null = null;

export function initProfileManager(dir?: string): ProfileManager {
  globalProfileManager = new ProfileManager(dir);
  return globalProfileManager;
}

export function getProfileManager(): ProfileManager {
  if (!globalProfileManager) {
    return initProfileManager();
  }
  return globalProfileManager;
}
