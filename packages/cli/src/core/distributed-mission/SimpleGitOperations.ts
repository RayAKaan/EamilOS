import { simpleGit, type SimpleGit } from 'simple-git';
import type { GitOperations } from './GitWorkspaceCoordinator.js';

export class SimpleGitOperations implements GitOperations {
  private readonly git: SimpleGit;

  constructor(repoPath: string) {
    this.git = simpleGit(repoPath);
  }

  async inspectCommit(commit: string): Promise<{ branch: string; files: string[]; parent?: string }> {
    const meta = (await this.git.raw(['show', '-s', '--format=%H %P', commit])).trim();
    const [resolved, parent, ...rest] = meta.split(/\s+/);
    if (!resolved) throw new Error('GIT_COMMIT_NOT_FOUND:' + commit);

    const files = (await this.git.raw(['diff', '--name-only', `${resolved}^`, resolved]))
      .split(/\r?\n/).map(value => value.trim()).filter(Boolean).sort();

    const branches = (await this.git.raw(['branch', '--contains', resolved, '--format=%(refname:short)']))
      .split(/\r?\n/).map(value => value.trim()).filter(Boolean);

    return { branch: branches[0] ?? resolved, files, parent: parent || rest[0] };
  }

  async merge(baseRef: string, commit: string): Promise<{ commit: string }> {
    await this.git.raw(['checkout', baseRef]);
    await this.git.raw(['merge', '--no-ff', '--no-edit', commit]);
    const resolved = (await this.git.revparse(['HEAD'])).trim();
    return { commit: resolved };
  }

  async abortMerge(): Promise<void> {
    try {
      await this.git.raw(['merge', '--abort']);
    } catch {
      // The merge may have failed before Git created MERGE_HEAD.
    }
  }

  async removeWorktree(path: string): Promise<void> {
    await this.git.raw(['worktree', 'remove', '--force', path]);
  }
}
