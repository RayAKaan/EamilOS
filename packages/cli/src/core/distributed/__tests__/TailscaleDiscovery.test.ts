import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExec = vi.fn();
vi.mock('child_process', () => ({ exec: mockExec }));
vi.mock('util', () => ({
  promisify: () => (cmd: string, opts?: unknown) => {
    return new Promise((resolve, reject) => {
      mockExec(cmd, opts, (err: Error | null, stdout: string) => {
        if (err) reject(err);
        else resolve({ stdout });
      });
    });
  },
}));

const { TailscaleDiscovery } = await import('../TailscaleDiscovery.js');

describe('TailscaleDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isAvailable should return true when tailscale is running', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, JSON.stringify({ BackendState: 'Running' }));
    });

    const result = await TailscaleDiscovery.isAvailable();
    expect(result).toBe(true);
  });

  it('isAvailable should return false when tailscale is stopped', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, JSON.stringify({ BackendState: 'Stopped' }));
    });

    const result = await TailscaleDiscovery.isAvailable();
    expect(result).toBe(false);
  });

  it('isAvailable should return false when not installed', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(new Error('command not found'));
    });

    const result = await TailscaleDiscovery.isAvailable();
    expect(result).toBe(false);
  });

  it('discoverPeers should return online peers', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, JSON.stringify({
        Self: { HostName: 'my-machine' },
        Peer: {
          'peer1': {
            HostName: 'workstation-1',
            TailscaleIPs: ['100.64.0.1'],
            PublicKey: 'key1',
            Online: true,
            OS: 'linux',
          },
          'peer2': {
            HostName: 'laptop-1',
            TailscaleIPs: ['100.64.0.2'],
            PublicKey: 'key2',
            Online: false,
            OS: 'darwin',
          },
        },
      }));
    });

    const peers = await TailscaleDiscovery.discoverPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0].hostname).toBe('workstation-1');
    expect(peers[0].tailscaleIP).toBe('100.64.0.1');
    expect(peers[0].os).toBe('linux');
  });

  it('discoverPeers should return empty array on error', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(new Error('not installed'));
    });

    const peers = await TailscaleDiscovery.discoverPeers();
    expect(peers).toEqual([]);
  });

  it('getSelfIP should return the Tailscale IP', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, '100.64.0.100\n');
    });

    const ip = await TailscaleDiscovery.getSelfIP();
    expect(ip).toBe('100.64.0.100');
  });

  it('getSelfIP should return null on error', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(new Error('not available'));
    });

    const ip = await TailscaleDiscovery.getSelfIP();
    expect(ip).toBeNull();
  });

  it('findPeer should return a peer by hostname', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, JSON.stringify({
        Self: { HostName: 'my-machine' },
        Peer: {
          'peer1': {
            HostName: 'workstation-1',
            TailscaleIPs: ['100.64.0.1'],
            Online: true,
            OS: 'linux',
          },
        },
      }));
    });

    const peer = await TailscaleDiscovery.findPeer('workstation-1');
    expect(peer).not.toBeNull();
    expect(peer!.tailscaleIP).toBe('100.64.0.1');
  });

  it('findPeer should return a peer by IP', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, JSON.stringify({
        Self: { HostName: 'my-machine' },
        Peer: {
          'peer1': {
            HostName: 'workstation-1',
            TailscaleIPs: ['100.64.0.1'],
            Online: true,
            OS: 'linux',
          },
        },
      }));
    });

    const peer = await TailscaleDiscovery.findPeer('100.64.0.1');
    expect(peer).not.toBeNull();
    expect(peer!.hostname).toBe('workstation-1');
  });

  it('findPeer should return null when not found', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, JSON.stringify({
        Self: { HostName: 'my-machine' },
        Peer: {},
      }));
    });

    const peer = await TailscaleDiscovery.findPeer('nonexistent');
    expect(peer).toBeNull();
  });
});
