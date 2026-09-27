import { generateKeyPairSync, randomUUID } from 'crypto';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { FabricNodeIdentity } from './types.js';

interface StoredIdentity extends FabricNodeIdentity { privateKey: string; }

export class FabricIdentityStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<{ identity: FabricNodeIdentity; privateKey: string } | null> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as StoredIdentity;
      if (!raw.nodeId || !raw.publicKey || !raw.privateKey) return null;
      return {
        identity: { nodeId: raw.nodeId, name: raw.name, publicKey: raw.publicKey, version: raw.version, createdAt: raw.createdAt },
        privateKey: raw.privateKey,
      };
    } catch { return null; }
  }

  async loadOrCreate(name: string, version: string): Promise<{ identity: FabricNodeIdentity; privateKey: string }> {
    const existing = await this.load();
    if (existing) return existing;
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const identity: FabricNodeIdentity = { nodeId: randomUUID(), name, publicKey, version, createdAt: Date.now() };
    const stored: StoredIdentity = { ...identity, privateKey };
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = join(dirname(this.filePath), \`.1790547294905.tmp\`);
    await writeFile(temp, JSON.stringify(stored, null, 2), { mode: 0o600 });
    await rename(temp, this.filePath);
    return { identity, privateKey };
  }
}
