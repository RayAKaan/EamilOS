import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProfileManager } from '../../src/auth/index.js';
import { KeyVault } from '../../src/auth/key-vault.js';

describe('ProfileManager', () => {
  let tmpDir: string;
  let pm: ProfileManager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `eamilos-test-${Date.now()}`);
    pm = new ProfileManager(tmpDir);
  });

  it('creates a profile', () => {
    const profile = pm.createProfile('test-user', 'test@example.com');
    expect(profile.name).toBe('test-user');
    expect(profile.email).toBe('test@example.com');
    expect(profile.id).toBeDefined();
    expect(profile.role).toBe('owner');
    expect(profile.teamId).toBeNull();
  });

  it('sets active profile on first create', () => {
    const profile = pm.createProfile('test-user', 'test@example.com');
    const active = pm.getActiveProfile();
    expect(active?.id).toBe(profile.id);
  });

  it('lists profiles sorted by lastActive', () => {
    pm.createProfile('user1', 'user1@example.com');
    pm.createProfile('user2', 'user2@example.com');
    const profiles = pm.listProfiles();
    expect(profiles.length).toBe(2);
  });

  it('switches active profile', () => {
    const p1 = pm.createProfile('user1', 'user1@example.com');
    const p2 = pm.createProfile('user2', 'user2@example.com');
    pm.setActiveProfile(p1.id);
    expect(pm.getActiveProfile()?.id).toBe(p1.id);
    pm.setActiveProfile(p2.id);
    expect(pm.getActiveProfile()?.id).toBe(p2.id);
  });

  it('deletes a profile', () => {
    const profile = pm.createProfile('user1', 'user1@example.com');
    expect(pm.deleteProfile(profile.id)).toBe(true);
    expect(pm.getProfile(profile.id)).toBeUndefined();
    expect(pm.getProfileCount()).toBe(0);
  });

  it('joins and leaves a team', () => {
    const profile = pm.createProfile('user1', 'user1@example.com');
    pm.joinTeam(profile.id, 'team-123', 'member');
    expect(pm.getProfile(profile.id)?.teamId).toBe('team-123');
    pm.leaveTeam(profile.id);
    expect(pm.getProfile(profile.id)?.teamId).toBeNull();
  });

  it('exports profile data', () => {
    const profile = pm.createProfile('user1', 'user1@example.com');
    const data = pm.exportProfileData(profile.id);
    expect(data).not.toBeNull();
    const parsed = JSON.parse(data!);
    expect(parsed.profile.name).toBe('user1');
  });

  it('returns null for non-existent profile export', () => {
    expect(pm.exportProfileData('non-existent')).toBeNull();
  });
});

describe('KeyVault', () => {
  let tmpDir: string;
  let kv: KeyVault;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `eamilos-vault-${Date.now()}`);
    kv = new KeyVault(tmpDir);
  });

  it('stores and retrieves a key', () => {
    kv.setKey('profile-1', 'openai', 'sk-test-key-123');
    const key = kv.getKey('profile-1', 'openai');
    expect(key).toBe('sk-test-key-123');
  });

  it('returns null for non-existent key', () => {
    expect(kv.getKey('profile-1', 'openai')).toBeNull();
  });

  it('updates an existing key', () => {
    kv.setKey('profile-1', 'openai', 'old-key');
    kv.setKey('profile-1', 'openai', 'new-key');
    expect(kv.getKey('profile-1', 'openai')).toBe('new-key');
  });

  it('deletes a key', () => {
    kv.setKey('profile-1', 'openai', 'test-key');
    expect(kv.deleteKey('profile-1', 'openai')).toBe(true);
    expect(kv.getKey('profile-1', 'openai')).toBeNull();
  });

  it('lists keys for a profile', () => {
    kv.setKey('profile-1', 'openai', 'key1');
    kv.setKey('profile-1', 'anthropic', 'key2');
    const keys = kv.listKeys('profile-1');
    expect(keys.length).toBe(2);
    expect(keys.map(k => k.provider)).toContain('openai');
    expect(keys.map(k => k.provider)).toContain('anthropic');
  });

  it('wipes all keys for a profile', () => {
    kv.setKey('profile-1', 'openai', 'key1');
    kv.setKey('profile-1', 'anthropic', 'key2');
    kv.wipeProfile('profile-1');
    expect(kv.getKey('profile-1', 'openai')).toBeNull();
    expect(kv.getKey('profile-1', 'anthropic')).toBeNull();
  });

  it('encrypts stored keys', () => {
    kv.setKey('profile-1', 'openai', 'secret-key');
    const keyPath = path.join(tmpDir, 'keys.json');
    const data = fs.readFileSync(keyPath, 'utf-8');
    const parsed = JSON.parse(data);
    expect(parsed[0].encrypted).not.toBe('secret-key');
    expect(parsed[0].encrypted).toContain(':');
  });
});
