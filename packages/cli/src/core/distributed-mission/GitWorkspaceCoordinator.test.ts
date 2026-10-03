import { describe, expect, it } from 'vitest';
import { GitWorkspaceCoordinator, type GitOperations } from './GitWorkspaceCoordinator.js';

const ops = (filesByCommit: Record<string, string[]>): GitOperations => ({
  async inspectCommit(commit) {
    if (!filesByCommit[commit]) throw new Error('missing');
    return { commit, branch: 'eamilos/test', files: filesByCommit[commit], parent: 'base' };
  },
  async merge(_base, commit) { return { commit: 'integrated-' + commit }; },
  async abortMerge() {},
  async removeWorktree() {},
});

describe('Phase 7E Git workspace and integration authority', () => {
  it('derives deterministic workspace identity and rejects invalid attempts', () => {
    const git = new GitWorkspaceCoordinator({ baseRef: 'main', worktreeRoot: '/tmp/eamilos' });
    expect(git.allocate('m', 't', 'n', 2)).toMatchObject({
      branch: 'eamilos/mission/m/task/t/attempt-2',
      worktreePath: '/tmp/eamilos/t/attempt-2',
      baseRef: 'main',
    });
    expect(() => git.allocate('m', 't', 'n', 0)).toThrow('INVALID_GIT_WORKSPACE_IDENTITY');
  });

  it('builds a deterministic integration order independent of arrival order', () => {
    const git = new GitWorkspaceCoordinator({ baseRef: 'main' });
    const a = git.markReadyForIntegration(git.markActive(git.allocate('m', 'task-b', 'n2', 1)));
    const b = git.markReadyForIntegration(git.markActive(git.allocate('m', 'task-a', 'n1', 1)));
    const plan = git.buildIntegrationPlan([
      { workspace: a, commit: 'b', changedFiles: ['z.ts'] },
      { workspace: b, commit: 'a', changedFiles: ['a.ts'] },
    ]);
    expect(plan.orderedTaskIds).toEqual(['task-a', 'task-b']);
    expect(plan.conflicts).toEqual([]);
  });

  it('detects overlapping file ownership before mutating git', () => {
    const git = new GitWorkspaceCoordinator({ baseRef: 'main' });
    const a = git.markReadyForIntegration(git.markActive(git.allocate('m', 'task-a', 'n1', 1)));
    const b = git.markReadyForIntegration(git.markActive(git.allocate('m', 'task-b', 'n2', 1)));
    const plan = git.buildIntegrationPlan([
      { workspace: a, commit: 'a', changedFiles: ['src/shared.ts'] },
      { workspace: b, commit: 'b', changedFiles: ['src/shared.ts'] },
    ]);
    expect(plan.conflicts).toEqual([{
      taskIds: ['task-a', 'task-b'],
      files: ['src/shared.ts'],
      reason: 'overlapping_files',
    }]);
  });

  it('integrates conflict-free candidates in deterministic order', async () => {
    const git = new GitWorkspaceCoordinator({ baseRef: 'main' });
    const a = git.markReadyForIntegration(git.markActive(git.allocate('m', 'task-a', 'n1', 1)));
    const b = git.markReadyForIntegration(git.markActive(git.allocate('m', 'task-b', 'n2', 1)));
    const candidates = await git.inspectCandidates([b, a], ops({ [a.branch]: ['a.ts'], [b.branch]: ['b.ts'] }));
    const plan = git.buildIntegrationPlan(candidates);
    const result = await git.integrate(plan, ops({ [a.branch]: ['a.ts'], [b.branch]: ['b.ts'] }));
    expect(result.integrated).toEqual(['task-a', 'task-b']);
    expect(result.conflicts).toEqual([]);
  });

  it('refuses cleanup while a workspace can still produce changes', async () => {
    const git = new GitWorkspaceCoordinator({ worktreeRoot: '/tmp/eamilos' });
    const active = git.markActive(git.allocate('m', 't', 'n', 1));
    await expect(git.cleanup(active, ops({}))).rejects.toThrow('GIT_WORKSPACE_STILL_ACTIVE');
    const abandoned = git.markAbandoned(active);
    await expect(git.cleanup(abandoned, ops({}))).resolves.toBeUndefined();
  });
});
