import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export interface StoredKey {
  id: string;
  profileId: string;
  provider: string;
  encrypted: string;
  createdAt: number;
}

export class KeyVault {
  private vaultDir: string;
  private keyPath: string;
  private keys: Map<string, StoredKey[]> = new Map();
  private masterKey: Buffer;

  constructor(vaultDir?: string) {
    this.vaultDir = vaultDir || path.join(os.homedir(), '.eamilos', 'vault');
    this.keyPath = path.join(this.vaultDir, 'keys.json');
    this.ensureDir();
    this.masterKey = this.getOrCreateMasterKey();
    this.loadKeys();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.vaultDir)) {
      fs.mkdirSync(this.vaultDir, { recursive: true, mode: 0o700 });
    }
  }

  private getOrCreateMasterKey(): Buffer {
    const keyPath = path.join(this.vaultDir, '.master');
    if (fs.existsSync(keyPath)) {
      return Buffer.from(fs.readFileSync(keyPath, 'utf-8'), 'hex');
    }
    const key = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
    return key;
  }

  private encrypt(value: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  private decrypt(encrypted: string): string {
    const [ivHex, authTagHex, encryptedHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private loadKeys(): void {
    this.keys.clear();
    if (!fs.existsSync(this.keyPath)) return;

    try {
      const data = JSON.parse(fs.readFileSync(this.keyPath, 'utf-8')) as StoredKey[];
      for (const key of data) {
        const profileKeys = this.keys.get(key.profileId) || [];
        profileKeys.push(key);
        this.keys.set(key.profileId, profileKeys);
      }
    } catch {
      // Ignore corrupted vault
    }
  }

  private saveKeys(): void {
    const allKeys: StoredKey[] = [];
    for (const profileKeys of this.keys.values()) {
      allKeys.push(...profileKeys);
    }
    fs.writeFileSync(this.keyPath, JSON.stringify(allKeys, null, 2), { mode: 0o600 });
  }

  setKey(profileId: string, provider: string, value: string): string {
    const profileKeys = this.keys.get(profileId) || [];

    const existing = profileKeys.findIndex(k => k.provider === provider);
    const key: StoredKey = {
      id: crypto.randomUUID(),
      profileId,
      provider,
      encrypted: this.encrypt(value),
      createdAt: Date.now(),
    };

    if (existing >= 0) {
      profileKeys[existing] = key;
    } else {
      profileKeys.push(key);
    }

    this.keys.set(profileId, profileKeys);
    this.saveKeys();
    return key.id;
  }

  getKey(profileId: string, provider: string): string | null {
    const profileKeys = this.keys.get(profileId);
    if (!profileKeys) return null;

    const key = profileKeys.find(k => k.provider === provider);
    if (!key) return null;

    try {
      return this.decrypt(key.encrypted);
    } catch {
      return null;
    }
  }

  deleteKey(profileId: string, provider: string): boolean {
    const profileKeys = this.keys.get(profileId);
    if (!profileKeys) return false;

    const idx = profileKeys.findIndex(k => k.provider === provider);
    if (idx < 0) return false;

    profileKeys.splice(idx, 1);
    this.keys.set(profileId, profileKeys);
    this.saveKeys();
    return true;
  }

  listKeys(profileId: string): Array<{ provider: string; createdAt: number }> {
    const profileKeys = this.keys.get(profileId);
    if (!profileKeys) return [];

    return profileKeys.map(k => ({
      provider: k.provider,
      createdAt: k.createdAt,
    }));
  }

  wipeProfile(profileId: string): void {
    this.keys.delete(profileId);
    this.saveKeys();
  }

  wipeAll(): void {
    this.keys.clear();
    if (fs.existsSync(this.keyPath)) {
      fs.unlinkSync(this.keyPath);
    }
  }
}

let globalKeyVault: KeyVault | null = null;

export function initKeyVault(dir?: string): KeyVault {
  globalKeyVault = new KeyVault(dir);
  return globalKeyVault;
}

export function getKeyVault(): KeyVault {
  if (!globalKeyVault) {
    return initKeyVault();
  }
  return globalKeyVault;
}
