import type { GitWorkspace } from './types.js';

export interface GitWorkspaceCoordinatorOptions {
  baseRef?: string;
  worktreeRoot?: string;
}

export class GitWorkspaceCoordinator {
  constructor(private readonly options: GitWorkspaceCoordinatorOptions = {}) {}

  allocate(missionId: string, taskId: string, nodeId: string, attempt: number): GitWorkspace {
    const branch = `eamilos/mission/${missionId}/task/${taskId}/attempt-${attempt}`;
    const worktreePath = this.options.worktreeRoot
      ? `${this.options.worktreeRoot}/${taskId}/attempt-${attempt}`
      : undefined;
    return {
      missionId,
      taskId,
      nodeId,
      branch,
      baseRef: this.options.baseRef ?? 'main',
      worktreePath,
      status: 'allocated',
    };
  }

  markActive(workspace: GitWorkspace): GitWorkspace {
    return { ...workspace, status: 'active' };
  }

  markReadyForIntegration(workspace: GitWorkspace): GitWorkspace {
    return { ...workspace, status: 'ready_for_integration' };
  }

  markIntegrated(workspace: GitWorkspace): GitWorkspace {
    return { ...workspace, status: 'integrated' };
  }

  markAbandoned(workspace: GitWorkspace): GitWorkspace {
    return { ...workspace, status: 'abandoned' };
  }
}
