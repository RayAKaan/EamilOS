import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UniversalAgentDefinition } from './types.js';

interface ReleaseAsset { name: string; browser_download_url: string; }
interface Release { tag_name: string; assets: ReleaseAsset[]; }

export class GitHubReleaseInstaller {
  async install(definition: UniversalAgentDefinition, timeoutMs = 120000): Promise<{ success: boolean; message: string; executable?: string }> {
    const release = definition.installation.release;
    if (!release) return { success: false, message: 'No verified GitHub release manifest configured.' };
    const assets = release.assets[process.platform] ?? [];
    if (!assets.length) return { success: false, message: `No release asset configured for ${process.platform}.` };
    const response = await fetch(`https://api.github.com/repos/${release.repository}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'eamilos-agent-installer' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { success: false, message: `GitHub release lookup failed: HTTP ${response.status}` };
    const latest = await response.json() as Release;
    const asset = latest.assets.find(item => assets.includes(item.name));
    if (!asset) return { success: false, message: `No matching release asset found for ${definition.id}.` };

    const dataResponse = await fetch(asset.browser_download_url, { headers: { 'user-agent': 'eamilos-agent-installer' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!dataResponse.ok) return { success: false, message: `Release download failed: HTTP ${dataResponse.status}` };
    const bytes = Buffer.from(await dataResponse.arrayBuffer());
    const digest = createHash('sha256').update(bytes).digest('hex');

    // Checksums are optional but, when a checksum asset is declared, require it before installation.
    if (release.checksumAssets?.length) {
      const checksumAsset = latest.assets.find(item => release.checksumAssets!.includes(item.name));
      if (!checksumAsset) return { success: false, message: 'Declared checksum asset is missing from the release.' };
      const checksumResponse = await fetch(checksumAsset.browser_download_url, { headers: { 'user-agent': 'eamilos-agent-installer' }, signal: AbortSignal.timeout(timeoutMs) });
      if (!checksumResponse.ok) return { success: false, message: 'Checksum asset could not be downloaded.' };
      const checksumText = await checksumResponse.text();
      if (!checksumText.includes(digest)) return { success: false, message: 'SHA-256 verification failed; refusing installation.' };
    }

    if (release.archive && release.archive !== 'binary') {
      return { success: false, message: 'Archive extraction is intentionally delegated to a future platform-specific installer; refusing to guess archive layout.' };
    }

    const targetDir = join(homedir(), '.eamilos', 'agents', definition.id);
    await mkdir(targetDir, { recursive: true });
    const target = join(targetDir, release.executable ?? definition.executableCandidates[0] ?? definition.id);
    const tmp = join(tmpdir(), `eamilos-${definition.id}-${Date.now()}`);
    await writeFile(tmp, bytes);
    await rename(tmp, target);
    if (process.platform !== 'win32') await chmod(target, 0o755);
    await rm(tmp, { force: true });
    return { success: true, message: `Installed ${definition.name} ${latest.tag_name} (${digest.slice(0, 12)})`, executable: target };
  }
}
