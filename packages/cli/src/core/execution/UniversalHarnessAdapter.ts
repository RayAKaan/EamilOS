import { UniversalAgentRegistry } from '../agents/universal/UniversalAgentRegistry.js';
import { UniversalAgentRuntime } from '../agents/universal/AgentRuntime.js';
import { ExecutionStore } from '../agents/universal/ExecutionStore.js';
import type { UniversalAgentDefinition } from '../agents/universal/types.js';
import type { HarnessAdapter } from './HarnessAdapter.js';
import type {
  ExecutionCheckpoint,
  ExecutionFailure,
  HarnessAvailability,
  HarnessDescriptor,
  HarnessExecutionRequest,
  HarnessExecutionResult,
  HarnessHealth,
} from './types.js';
import { HarnessDescriptorSchema } from './types.js';

function failureType(errorType?: string): ExecutionFailure {
  switch (errorType) {
    case 'auth_missing': return 'AUTH_REQUIRED';
    case 'auth_failed': return 'AUTH_FAILED';
    case 'quota_exceeded': return 'QUOTA_EXHAUSTED';
    case 'rate_limited': return 'RATE_LIMIT';
    case 'timeout': return 'TIMEOUT';
    case 'permission_denied': return 'PERMISSION_DENIED';
    case 'token_limit': return 'CONTEXT_LIMIT';
    case 'crash': return 'CRASH';
    case 'not_installed': return 'HARNESS_NOT_FOUND';
    default: return 'UNKNOWN';
  }
}

function descriptorFor(definition: UniversalAgentDefinition): HarnessDescriptor {
  const c = definition.capabilities;
  return HarnessDescriptorSchema.parse({
    id: definition.id,
    name: definition.name,
    kind: definition.kind === 'harness' ? 'local' : definition.kind === 'api' ? 'api' : 'cli',
    provider: definition.provider,
    command: definition.executableCandidates[0],
    args: [],
    capabilities: {
      codeGeneration: c.codeGeneration,
      fileEditing: c.fileEditing,
      commandExecution: c.commandExecution,
      webResearch: c.webResearch,
      communication: true,
      execution: true,
      local: c.local,
      remote: c.remoteExecution || definition.kind === 'remote',
      streaming: c.streaming,
      cancellation: true,
      checkpointResume: c.resumeSessions,
      workspaceIsolation: c.sandboxing,
      multimodal: c.multimodal,
      longContext: c.longContext,
    },
    supportedModes: ['communication', 'execution'],
    status: 'DISCOVERED',
    availability: {
      installed: false,
      authenticated: false,
      executable: false,
      checkedAt: new Date().toISOString(),
    },
  });
}

export class UniversalHarnessAdapter implements HarnessAdapter {
  readonly descriptor: HarnessDescriptor;
  private runtime?: UniversalAgentRuntime;
  private readonly store: ExecutionStore;

  constructor(
    private readonly definition: UniversalAgentDefinition,
    private readonly registry: UniversalAgentRegistry,
    store?: ExecutionStore,
  ) {
    this.descriptor = descriptorFor(definition);
    this.store = store ?? new ExecutionStore();
  }

  async detect(): Promise<HarnessAvailability> {
    const health = await this.registry.health(this.definition.id);
    return {
      installed: health.installed,
      authenticated: health.authenticated === true || health.authenticated === 'unknown',
      executable: Boolean(health.executable),
      checkedAt: new Date().toISOString(),
      reason: health.checks.find((check) => !check.ok)?.detail,
    };
  }

  async health(): Promise<HarnessHealth> {
    const availability = await this.detect();
    const status: HarnessHealth['status'] =
      !availability.installed ? 'NOT_INSTALLED' :
      !availability.authenticated ? 'AUTH_REQUIRED' :
      !availability.executable ? 'UNAVAILABLE' : 'AVAILABLE';
    return {
      harnessId: this.definition.id,
      status,
      lastCheckedAt: availability.checkedAt,
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
    };
  }

  async start(
    request: HarnessExecutionRequest,
    onOutput?: (chunk: string) => void,
  ): Promise<HarnessExecutionResult> {
    await this.ensureStoreLoaded();
    const runtime = this.createRuntime(request);
    this.runtime = runtime;
    const response = await runtime.execute({
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
        checkpoint: request.context.checkpoint,
      },
      onOutput,
    });
    return this.toResult(request, response);
  }

  async cancel(executionId: string): Promise<void> {
    const session = this.runtime?.getSessions().find((item) => item.id === executionId || item.status === 'running');
    if (session && this.runtime) {
      await this.runtime.stop(session.id);
      return;
    }
    const record = this.store.get(executionId);
    if (record?.sessionId && this.runtime) await this.runtime.stop(record.sessionId);
  }

  async checkpoint(executionId: string): Promise<ExecutionCheckpoint> {
    await this.ensureStoreLoaded();
    const record = this.store.get(executionId);
    if (!record) throw new Error(`Execution '${executionId}' not found`);
    return {
      id: `checkpoint_${executionId}`,
      missionId: record.taskId ? 'unknown' : 'unknown',
      taskId: record.taskId,
      executionId,
      harnessId: record.agentId,
      nodeId: record.agentId,
      createdAt: new Date().toISOString(),
      progress: { completedSteps: [], remainingSteps: ['resume assigned task'] },
      output: record.checkpoint?.output ?? record.response?.rawOutput ?? record.response?.content ?? '',
      artifacts: [],
      resumeContext: 'Resume from the recorded output without repeating completed work.',
      metadata: { source: 'universal-agent-execution-store' },
    };
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
        checkpoint,
        priorOutput: checkpoint.output,
      },
    }, onOutput);
  }

  private createRuntime(request: HarnessExecutionRequest): UniversalAgentRuntime {
    const detection = this.registry.getDetection(this.definition.id);
    return new UniversalAgentRuntime(this.definition, {
      workingDir: request.workingDir,
      timeoutMs: request.timeoutMs,
      executable: detection?.executable,
      store: this.store,
    });
  }

  private async ensureStoreLoaded(): Promise<void> {
    if (!this.store.isLoaded()) await this.store.load();
  }

  private buildPrompt(request: HarnessExecutionRequest): string {
    const context = request.context;
    return [
      `MISSION GOAL: ${context.missionGoal}`,
      `TASK OBJECTIVE: ${context.taskObjective}`,
      context.acceptanceCriteria.length ? `ACCEPTANCE CRITERIA:\n${context.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}` : '',
      context.relevantFiles.length ? `RELEVANT FILES:\n${context.relevantFiles.map((item) => `- ${item}`).join('\n')}` : '',
      context.dependencies.length ? `DEPENDENCIES:\n${context.dependencies.map((item) => `- ${item}`).join('\n')}` : '',
      context.priorOutput ? `PRIOR OUTPUT:\n${context.priorOutput}` : '',
      context.checkpoint ? `RESUME CHECKPOINT:\n${context.checkpoint.output}` : '',
      `TASK:\n${request.prompt}`,
    ].filter(Boolean).join('\n\n');
  }

  private toResult(
    request: HarnessExecutionRequest,
    response: import('../agents/types.js').AgentResponse,
  ): HarnessExecutionResult {
    const failure = response.success ? undefined : failureType(response.errorType);
    const completedAt = new Date().toISOString();
    return {
      executionId: request.executionId,
      missionId: request.missionId,
      taskId: request.taskId,
      harnessId: request.harnessId,
      nodeId: request.nodeId,
      status: response.success ? 'COMPLETED' :
        failure === 'QUOTA_EXHAUSTED' ? 'QUOTA_EXHAUSTED' :
        failure === 'AUTH_FAILED' || failure === 'AUTH_REQUIRED' ? 'AUTH_FAILED' :
        failure === 'TIMEOUT' ? 'TIMED_OUT' : 'RECOVERABLE',
      output: response.content,
      artifacts: response.fileChanges.map((change) => ({ path: change.path, type: 'file' })),
      fileChanges: response.fileChanges.map((change) => ({ path: change.path, action: change.action })),
      evidence: [],
      error: response.success || !failure ? undefined : {
        type: failure,
        message: response.error ?? 'Universal agent execution failed',
        retryable: ['RATE_LIMIT', 'TIMEOUT', 'CRASH', 'WORKER_LOST'].includes(failure),
        fallbackEligible: !['PERMISSION_DENIED', 'INVALID_OUTPUT'].includes(failure),
      },
      metrics: {
        startedAt: new Date(Date.now() - response.durationMs).toISOString(),
        completedAt,
        durationMs: response.durationMs,
        tokensUsed: response.tokensUsed,
        costUsd: response.costUsd,
      },
    };
  }
}

export function createUniversalHarnessAdapters(
  registry = new UniversalAgentRegistry(),
  store = new ExecutionStore(),
): UniversalHarnessAdapter[] {
  return registry.list().map((definition) => new UniversalHarnessAdapter(definition, registry, store));
}
