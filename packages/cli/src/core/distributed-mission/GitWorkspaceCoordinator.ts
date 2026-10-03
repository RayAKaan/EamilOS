import type { GitWorkspace } from './types.js';

export interface GitWorkspaceCoordinatorOptions {
  baseRef?: string;
  worktreeRoot?: string;
}

export interface GitCommitEvidence {
  commit: string;
  branch: string;
  files: string[];
  parent?: string;
}

export interface GitIntegrationCandidate {
  workspace: GitWorkspace;
  commit: string;
  changedFiles: string[];
}

export interface GitIntegrationConflict {
  taskIds: string[];
  files: string[];
  reason: 'overlapping_files' | 'invalid_base' | 'missing_commit';
}

export interface GitIntegrationPlan {
  baseRef: string;
  candidates: GitIntegrationCandidate[];
  conflicts: GitIntegrationConflict[];
  orderedTaskIds: string[];
}

export interface GitOperations {
  inspectCommit(commit: string): Promise<{ commit: string; branch: string; files: string[]; parent?: string }>;
  merge(baseRef: string, commit: string): Promise<{ commit: string }>;
  abortMerge(): Promise<void>;
  removeWorktree(path: string): Promise<void>;
}

/**
 * Owns deterministic task workspaces and integration arbitration.
 *
 * Workspace identity is derived exclusively from mission/task/attempt. Integration
 * ordering is deterministic and never depends on worker arrival order.
 */
export class GitWorkspaceCoordinator {
  constructor(private readonly options: GitWorkspaceCoordinatorOptions = {}) {}

  allocate(missionId: string, taskId: string, nodeId: string, attempt: number): GitWorkspace {
    if (!missionId || !taskId || !nodeId || !Number.isInteger(attempt) || attempt < 1) {
      throw new Error('INVALID_GIT_WORKSPACE_IDENTITY');
    }
    const branch = `eamilos/mission/${missionId}/task/${taskId}/attempt-${attempt}`;
    const worktreePath = this.options.worktreeRoot
      ? `${this.options.worktreeRoot}/${taskId}/attempt-${attempt}`
      : undefined;
    return {
      missionId, taskId, nodeId, branch,
      baseRef: this.options.baseRef ?? 'main',
      worktreePath, status: 'allocated',
    };
  }

  markActive(workspace: GitWorkspace): GitWorkspace {
    return { ...workspace, status: 'active' };
  }

  markReadyForIntegration(workspace: GitWorkspace): GitWorkspace {
    if (workspace.status !== 'active') throw new Error('GIT_WORKSPACE_NOT_ACTIVE');
    return { ...workspace, status: 'ready_for_integration' };
  }

  markIntegrated(workspace: GitWorkspace): GitWorkspace {
    if (workspace.status !== 'ready_for_integration') throw new Error('GIT_WORKSPACE_NOT_READY');
    return { ...workspace, status: 'integrated' };
  }

  markAbandoned(workspace: GitWorkspace): GitWorkspace {
    return { ...workspace, status: 'abandoned' };
  }

  buildIntegrationPlan(candidates: GitIntegrationCandidate[]): GitIntegrationPlan {
    const baseRef = this.options.baseRef ?? 'main';
    const sorted = [...candidates].sort((a, b) =>
      a.workspace.taskId.localeCompare(b.workspace.taskId) ||
      a.workspace.branch.localeCompare(b.workspace.branch),
    );
    const conflicts: GitIntegrationConflict[] = [];
    const seenFiles = new Map<string, string[]>();

    for (const candidate of sorted) {
      if (candidate.workspace.baseRef !== baseRef) {
        conflicts.push({
          taskIds: [candidate.workspace.taskId],
          files: [],
          reason: 'invalid_base',
        });
      }
      if (!candidate.commit) {
        conflicts.push({
          taskIds: [candidate.workspace.taskId],
          files: [],
          reason: 'missing_commit',
        });
      }
      for (const file of [...new Set(candidate.changedFiles)].sort()) {
        const owners = seenFiles.get(file) ?? [];
        for (const owner of owners) {
          const conflict = conflicts.find(
            item => item.reason === 'overlapping_files' &&
              item.files.length === 1 && item.files[0] === file,
          );
          if (conflict) {
            if (!conflict.taskIds.includes(owner)) conflict.taskIds.push(owner);
            if (!conflict.taskIds.includes(candidate.workspace.taskId)) conflict.taskIds.push(candidate.workspace.taskId);
          } else {
            conflicts.push({
              taskIds: [owner, candidate.workspace.taskId].sort(),
              files: [file],
              reason: 'overlapping_files',
            });
          }
        }
        seenFiles.set(file, [...owners, candidate.workspace.taskId]);
      }
    }

    return {
      baseRef,
      candidates: sorted.map(candidate => ({
        ...candidate,
        changedFiles: [...new Set(candidate.changedFiles)].sort(),
      })),
      conflicts: conflicts
        .map(conflict => ({ ...conflict, taskIds: [...new Set(conflict.taskIds)].sort() }))
        .sort((a, b) => a.reason.localeCompare(b.reason) || a.taskIds.join(',').localeCompare(b.taskIds.join(','))),
      orderedTaskIds: sorted.map(candidate => candidate.workspace.taskId),
    };
  }

  async inspectCandidates(
    workspaces: GitWorkspace[],
    operations: GitOperations,
  ): Promise<GitIntegrationCandidate[]> {
    const candidates: GitIntegrationCandidate[] = [];
    for (const workspace of workspaces) {
      if (workspace.status !== 'ready_for_integration') continue;
      const evidence = await operations.inspectCommit(workspace.branch);
      candidates.push({
        workspace,
        commit: evidence.commit,
        changedFiles: evidence.files,
      });
    }
    return candidates;
  }

  async integrate(
    plan: GitIntegrationPlan,
    operations: GitOperations,
  ): Promise<{ integrated: string[]; failed?: string; conflicts: GitIntegrationConflict[] }> {
    if (plan.conflicts.length > 0) return { integrated: [], conflicts: plan.conflicts };
    const integrated: string[] = [];

    for (const candidate of plan.candidates) {
      try {
        await operations.merge(plan.baseRef, candidate.commit);
        integrated.push(candidate.workspace.taskId);
      } catch (error) {
        await operations.abortMerge();
        return {
          integrated,
          failed: candidate.workspace.taskId,
          conflicts: [{
            taskIds: [candidate.workspace.taskId],
            files: candidate.changedFiles,
            reason: 'overlapping_files',
          }],
        };
      }
    }

    return { integrated, conflicts: [] };
  }

  async cleanup(workspace: GitWorkspace, operations: GitOperations): Promise<void> {
    if (!workspace.worktreePath) return;
    if (workspace.status === 'active' || workspace.status === 'ready_for_integration') {
      throw new Error('GIT_WORKSPACE_STILL_ACTIVE');
    }
    await operations.removeWorktree(workspace.worktreePath);
  }
}
