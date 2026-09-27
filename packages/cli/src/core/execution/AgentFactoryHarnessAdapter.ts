import { AgentFactory } from '../agents/AgentFactory.js';
import { getAgentDefinition } from '../agents/definitions.js';
import type { AgentResponse, EamilOSAgent } from '../agents/index.js';
import type { HarnessAdapter } from './HarnessAdapter.js';
import {
  type ExecutionCheckpoint,
  type HarnessAvailability,
  type HarnessDescriptor,
  type HarnessExecutionRequest,
  type HarnessExecutionResult,
  type HarnessHealth,
  type ExecutionFailure,
  HarnessDescriptorSchema,
} from './types.js';

function mapFailure(errorType?: AgentResponse['errorType']): ExecutionFailure {
  switch (errorType) {
    case 'rate_limited': return 'RATE_LIMIT';
    case 'quota_exceeded': return 'QUOTA_EXHAUSTED';
    case 'auth_missing': return 'AUTH_REQUIRED';
    case 'auth_failed': return 'AUTH_FAILED';
    case 'not_installed': return 'HARNESS_NOT_FOUND';
    case 'timeout': return 'TIMEOUT';
    case 'token_limit': return 'CONTEXT_LIMIT';
    case 'invalid_output': return 'INVALID_OUTPUT';
    case 'permission_denied': return 'PERMISSION_DENIED';
    case 'crash': return 'CRASH';
    default: return 'UNKNOWN';
  }
}

function capabilitiesFor(agent: AgentResponse | undefined, agentId: string) {
  void agent;
  const execution = ['opencode', 'claude-code', 'aider', 'goose', 'codex-cli'].includes(agentId);
  const research = ['opencode', 'claude-code', 'gemini-cli'].includes(agentId);

  return {
    codeGeneration: true,
    fileEditing: execution,
    commandExecution: execution,
    webResearch: research,
    communication: true,
    execution: true,
    local: ['opencode', 'aider', 'goose', 'codex-cli'].includes(agentId),
    remote: false,
    streaming: true,
    cancellation: true,
    checkpointResume: false,
    workspaceIsolation: true,
    multimodal: agentId === 'gemini-cli',
    longContext: ['opencode', 'claude-code', 'gemini-cli', 'codex-cli'].includes(agentId),
  };
}

export class AgentFactoryHarnessAdapter implements HarnessAdapter {
  readonly descriptor: HarnessDescriptor;
  private readonly agent: EamilOSAgent;

  constructor(
    descriptor: HarnessDescriptor,
    agent: EamilOSAgent,
  ) {
    this.descriptor = HarnessDescriptorSchema.parse(descriptor);
    this.agent = agent;
  }

  async detect(): Promise<HarnessAvailability> {
    const status = await this.agent.checkStatus();
    return {
      installed: status.status !== 'not_installed',
      authenticated: status.status !== 'auth_missing' && status.status !== 'auth_failed',
      executable: status.status !== 'not_installed',
      checkedAt: new Date().toISOString(),
      reason: status.error,
    };
  }

  async start(
    request: HarnessExecutionRequest,
    onOutput?: (chunk: string) => void,
  ): Promise<HarnessExecutionResult> {
    const startedAt = new Date().toISOString();

    const response = await this.agent.run({
      id: request.executionId,
      sessionId: request.executionId,
      prompt: this.buildPrompt(request),
      systemPrompt: '[EamilOS execution fabric] Execute only the assigned task and respect the declared resources.',
      mode: 'execution',
      workingDir: request.workingDir,
      timeoutMs: request.timeoutMs,
      context: {
        missionId: request.missionId,
        taskId: request.taskId,
        readSet: request.resources.readSet,
        writeSet: request.resources.writeSet,
      },
      onOutput,
    });

    return this.toResult(request, startedAt, response);
  }

  async cancel(_executionId: string): Promise<void> {
    if (this.agent.stop) {
      await this.agent.stop();
    }
  }

  async checkpoint(_executionId: string): Promise<ExecutionCheckpoint> {
    throw new Error(
      `Harness '${this.descriptor.id}' does not expose a native checkpoint API`,
    );
  }

  async resume(
    checkpoint: ExecutionCheckpoint,
    request: HarnessExecutionRequest,
    onOutput?: (chunk: string) => void,
  ): Promise<HarnessExecutionResult> {
    return this.start({
      ...request,
      context: {
        ...request.context,
        priorOutput: checkpoint.output,
        checkpoint,
      },
    }, onOutput);
  }

  async health(): Promise<HarnessHealth> {
    const availability = await this.detect();
    let status: HarnessHealth['status'] = 'UNAVAILABLE';

    if (availability.installed && availability.authenticated && availability.executable) {
      status = 'AVAILABLE';
    } else if (!availability.installed) {
      status = 'NOT_INSTALLED';
    } else if (!availability.authenticated) {
      status = 'AUTH_REQUIRED';
    }

    return {
      harnessId: this.descriptor.id,
      status,
      lastCheckedAt: availability.checkedAt,
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
    };
  }

  private buildPrompt(request: HarnessExecutionRequest): string {
    const checkpoint = request.context.checkpoint;
    const priorOutput = request.context.priorOutput;

    return [
      `MISSION GOAL: ${request.context.missionGoal}`,
      `TASK OBJECTIVE: ${request.context.taskObjective}`,
      request.context.acceptanceCriteria.length
        ? `ACCEPTANCE CRITERIA:\n${request.context.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}`
        : '',
      request.context.relevantFiles.length
        ? `RELEVANT FILES:\n${request.context.relevantFiles.map((item) => `- ${item}`).join('\n')}`
        : '',
      request.context.dependencies.length
        ? `DEPENDENCIES:\n${request.context.dependencies.map((item) => `- ${item}`).join('\n')}`
        : '',
      priorOutput ? `PRIOR OUTPUT:\n${priorOutput}` : '',
      checkpoint
        ? `RESUME CHECKPOINT:\nCompleted: ${checkpoint.progress.completedSteps.join(', ') || 'none'}\nRemaining: ${checkpoint.progress.remainingSteps.join(', ') || 'none'}`
        : '',
      `USER TASK:\n${request.prompt}`,
    ].filter(Boolean).join('\n\n');
  }

  private toResult(
    request: HarnessExecutionRequest,
    startedAt: string,
    response: AgentResponse,
  ): HarnessExecutionResult {
    const completedAt = new Date().toISOString();
    const failure = response.success ? undefined : mapFailure(response.errorType);

    return {
      executionId: request.executionId,
      missionId: request.missionId,
      taskId: request.taskId,
      harnessId: request.harnessId,
      nodeId: request.nodeId,
      status: response.success
        ? 'COMPLETED'
        : failure === 'QUOTA_EXHAUSTED'
          ? 'QUOTA_EXHAUSTED'
          : failure === 'AUTH_FAILED' || failure === 'AUTH_REQUIRED'
            ? 'AUTH_FAILED'
            : failure === 'TIMEOUT'
              ? 'TIMED_OUT'
              : 'RECOVERABLE',
      output: response.content,
      artifacts: response.fileChanges.map((change) => ({
        path: change.path,
        type: 'file',
      })),
      fileChanges: response.fileChanges.map((change) => ({
        path: change.path,
        action: change.action,
      })),
      evidence: [],
      error: response.success || !failure
        ? undefined
        : {
            type: failure,
            message: response.error || 'Harness execution failed',
            retryable: ['RATE_LIMIT', 'TIMEOUT', 'CRASH', 'WORKER_LOST'].includes(failure),
            fallbackEligible: [
              'RATE_LIMIT',
              'QUOTA_EXHAUSTED',
              'AUTH_REQUIRED',
              'AUTH_FAILED',
              'HARNESS_NOT_FOUND',
              'WORKER_UNAVAILABLE',
              'WORKER_LOST',
              'TIMEOUT',
              'CRASH',
              'CONTEXT_LIMIT',
            ].includes(failure),
          },
      metrics: {
        startedAt,
        completedAt,
        durationMs: response.durationMs,
        tokensUsed: response.tokensUsed,
        costUsd: response.costUsd,
      },
    };
  }
}

export function createCliHarnessAdapter(
  harnessId: string,
  workingDir?: string,
  timeoutMs = 300_000,
): AgentFactoryHarnessAdapter | null {
  const definition = getAgentDefinition(harnessId);
  const agent = AgentFactory.createAdapter(harnessId, { workingDir, timeoutMs });

  if (!definition || !agent) return null;

  const descriptor: HarnessDescriptor = {
    id: harnessId,
    name: definition.name,
    kind: 'cli',
    provider: harnessId,
    command: definition.command,
    args: definition.baseArgs,
    capabilities: capabilitiesFor(undefined, harnessId),
    supportedModes: ['communication', 'execution'],
    status: 'DISCOVERED',
    availability: {
      installed: false,
      authenticated: false,
      executable: false,
      checkedAt: new Date().toISOString(),
    },
  };

  return new AgentFactoryHarnessAdapter(descriptor, agent);
}
