import { simpleGit, type SimpleGit } from 'simple-git';
import type { GitWorkspace } from '../distributed-mission/types.js';

export interface GitHubWorkspaceManagerOptions {
  cwd: string;
  remote?: string;
  git?: SimpleGit;
}

export interface GitTaskPublication {
  branch: string;
  commit: string;
  pushed: boolean;
}

export class GitHubWorkspaceManager {
  private readonly git: SimpleGit;

  constructor(private readonly options: GitHubWorkspaceManagerOptions) {
    this.git = options.git ?? simpleGit(options.cwd);
  }

  async ensureBranch(workspace: GitWorkspace): Promise<void> {
    const branches = await this.git.branchLocal();
    if (!branches.all.includes(workspace.branch)) {
      await this.git.checkoutBranch(workspace.branch, workspace.baseRef);
    } else {
      await this.git.checkout(workspace.branch);
    }
  }

  async commitTask(workspace: GitWorkspace, message = `eamilos: complete task ${workspace.taskId}`): Promise<string> {
    await this.ensureBranch(workspace);
    const status = await this.git.status();
    if (status.files.length > 0) await this.git.add(status.files.map((file) => file.path));
    const commit = await this.git.commit(message);
    if (!commit.commit) throw new Error('Git commit did not produce a commit hash');
    return commit.commit;
  }

  async publish(workspace: GitWorkspace, message?: string): Promise<GitTaskPublication> {
    const commit = await this.commitTask(workspace, message);
    const remote = this.options.remote ?? 'origin';
    await this.git.push(remote, workspace.branch, ['--set-upstream']);
    return { branch: workspace.branch, commit, pushed: true };
  }

  async currentBranch(): Promise<string> {
    return (await this.git.branchLocal()).current;
  }
}
