export type TaskStatus = 'blocked' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ExecutionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ArtifactKind = 'source' | 'document' | 'test-report' | 'build' | 'report' | 'file';

export interface TaskRecord {
  id: string;
  missionId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  progress: number;
  dependsOn: string[];
  assignedAgentId?: string;
  assignedDeviceId?: string;
  currentExecutionId?: string;
  validation: 'idle' | 'running' | 'passed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface ExecutionRecord {
  id: string;
  taskId: string;
  sessionId: string;
  agentId?: string;
  deviceId?: string;
  status: ExecutionStatus;
  startedAt?: number;
  finishedAt?: number;
  events: string[];
}

export interface ArtifactRecord {
  id: string;
  missionId: string;
  taskId?: string;
  executionId?: string;
  path: string;
  kind: ArtifactKind;
  action: 'create' | 'modify' | 'delete';
  agentId?: string;
  validation: 'unknown' | 'passed' | 'failed';
  updatedAt: number;
}

export interface SessionRecord {
  id: string;
  missionId: string;
  goal: string;
  strategy: string;
  startedAt: number;
  durationMs?: number;
  status: 'running' | 'completed' | 'failed';
  executionIds: string[];
}

export interface GitCommitRecord {
  hash: string;
  subject: string;
  author?: string;
  timestamp?: number;
}

export interface PullRequestRecord {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  updatedAt?: number;
}

export interface GitHubState {
  available: boolean;
  repository?: string;
  remoteUrl?: string;
  branch?: string;
  dirty: boolean;
  changedFiles: string[];
  commits: GitCommitRecord[];
  ahead: number;
  behind: number;
  pullRequest?: PullRequestRecord;
  error?: string;
  refreshedAt?: number;
}

export interface ResourceRef {
  type: 'mission' | 'task' | 'execution' | 'session' | 'artifact' | 'file' | 'commit' | 'pull-request';
  id: string;
}

export interface MissionDataState {
  tasks: TaskRecord[];
  executions: ExecutionRecord[];
  artifacts: ArtifactRecord[];
  sessions: SessionRecord[];
  selectedTaskId?: string;
  selectedArtifactId?: string;
  selectedSessionId?: string;
  selectedExecutionId?: string;
  github: GitHubState;
}

export function initialMissionData(): MissionDataState {
  return {
    tasks: [],
    executions: [],
    artifacts: [],
    sessions: [],
    github: { available: false, dirty: false, changedFiles: [], commits: [], ahead: 0, behind: 0 },
  };
}
