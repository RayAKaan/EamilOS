import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DistributedMissionAuthority } from './DistributedMissionAuthority.js';
import type { MissionSnapshot } from '../mission/types.js';

function path(): string {
  return join(tmpdir(), 'eamilos-phase7b-' + randomUUID() + '.sqlite');
}

function snapshot(): MissionSnapshot {
  const now = new Date().toISOString();
  return {
    mission: {
      id: 'mission-7b',
      goal: 'durable distributed mission',
      status: 'created',
      workingDir: process.cwd(),
      requirements: {
        acceptanceCriteria: [],
        completionCriteria: [],
        requiredArtifacts: [],
        requiredCapabilities: [],
      },
      constraints: {
        maxConcurrentTasks: 3,
        maxTaskAttempts: 3,
        allowedPaths: [],
        deniedPaths: [],
        requireValidation: true,
        requireEvidence: true,
      },
      taskIds: [],
      evidenceIds: [],
      checkpointIds: [],
      createdAt: now,
      updatedAt: now,
      metadata: {},
    },
    tasks: [],
    checkpoints: [],
    evidence: [],
    events: [],
  };
}

function cleanup(filename: string): void {
  rmSync(filename, { force: true });
  rmSync(filename + '-wal', { force: true });
  rmSync(filename + '-shm', { force: true });
}

describe('Phase 7B distributed mission authority runtime', () => {
  it('creates and registers a mission as durable authority', () => {
    const filename = path();
    const authority = new DistributedMissionAuthority({ filename });
    const ledger = authority.open('mission-7b', snapshot());

    expect(ledger.graphVersion).toBe(1);
    expect(authority.listMissionIds()).toEqual(['mission-7b']);
    expect(authority.status('mission-7b')).toMatchObject({
      missionId: 'mission-7b',
      eventCount: 1,
      valid: true,
    });

    authority.close();
    cleanup(filename);
  });

  it('restores the same ledger after the authority runtime is recreated', () => {
    const filename = path();
    const first = new DistributedMissionAuthority({ filename });
    const ledger = first.open('mission-7b', snapshot());
    ledger.sync();
    const before = ledger.snapshot();
    first.close();

    const second = new DistributedMissionAuthority({ filename });
    const restored = second.restore('mission-7b');

    expect(restored.graphVersion).toBe(before.graphVersion);
    expect(restored.eventsSince(0)).toHaveLength(before.events.length);
    expect(second.verify('mission-7b').valid).toBe(true);

    second.close();
    cleanup(filename);
  });

  it('never replaces a durable mission with a caller-provided snapshot', () => {
    const filename = path();
    const first = new DistributedMissionAuthority({ filename });
    const initial = snapshot();
    first.open('mission-7b', initial).sync();
    first.close();

    const second = new DistributedMissionAuthority({ filename });
    const changed = snapshot();
    changed.mission.goal = 'untrusted replacement';
    const restored = second.open('mission-7b', changed);

    expect(restored.snapshot().missionId).toBe('mission-7b');
    expect(restored.snapshot().tasks).toHaveLength(0);
    expect(second.status('mission-7b')?.valid).toBe(true);

    second.close();
    cleanup(filename);
  });

  it('rejects use after shutdown', () => {
    const filename = path();
    const authority = new DistributedMissionAuthority({ filename });
    authority.close();

    expect(() => authority.listMissionIds()).toThrow('Distributed mission authority has been disposed');
    cleanup(filename);
  });
});
