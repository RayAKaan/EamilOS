import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface TailscalePeer {
  hostname: string;
  tailscaleIP: string;
  publicKey: string;
  online: boolean;
  os: string;
}

/**
 * Discovers Tailscale peers on the current network.
 * Requires Tailscale CLI (`tailscale`) to be installed and authenticated.
 */
export class TailscaleDiscovery {
  /**
   * Get the current machine's Tailscale IP.
   */
  static async getSelfIP(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('tailscale ip -4', { timeout: 5000 });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Get the current machine's Tailscale hostname.
   */
  static async getSelfHostname(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('tailscale status --self=true --json', { timeout: 5000 });
      const data = JSON.parse(stdout);
      return data.Self?.HostName || null;
    } catch {
      return null;
    }
  }

  /**
   * Discover all Tailscale peers (excluding self).
   * Returns peers that are online and reachable.
   */
  static async discoverPeers(): Promise<TailscalePeer[]> {
    try {
      const { stdout } = await execAsync('tailscale status --json', { timeout: 10000 });
      const data = JSON.parse(stdout);

      const peers: TailscalePeer[] = [];
      const peerEntries = data.Peer || {};

      for (const [key, peer] of Object.entries(peerEntries)) {
        const p = peer as {
          HostName?: string;
          TailscaleIPs?: string[];
          PublicKey?: string;
          Online?: boolean;
          OS?: string;
        };

        if (p.Online && p.TailscaleIPs && p.TailscaleIPs.length > 0) {
          peers.push({
            hostname: p.HostName || key,
            tailscaleIP: p.TailscaleIPs[0],
            publicKey: p.PublicKey || '',
            online: p.Online,
            os: p.OS || 'unknown',
          });
        }
      }

      return peers;
    } catch {
      return [];
    }
  }

  /**
   * Check if Tailscale is installed and authenticated.
   */
  static async isAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('tailscale status --json', { timeout: 5000 });
      const data = JSON.parse(stdout);
      return data.BackendState === 'Running';
    } catch {
      return false;
    }
  }

  /**
   * Find a peer by hostname or IP.
   */
  static async findPeer(identifier: string): Promise<TailscalePeer | null> {
    const peers = await this.discoverPeers();
    return peers.find(p =>
      p.hostname === identifier ||
      p.tailscaleIP === identifier
    ) || null;
  }
}
