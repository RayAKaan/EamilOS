import { randomUUID } from 'node:crypto';
import type { HarnessAdapter } from './HarnessAdapter.js';
import type {
  ExecutionCheckpoint,
  HarnessAvailability,
  HarnessDescriptor,
  HarnessExecutionRequest,
  HarnessExecutionResult,
  HarnessHealth,
} from './types.js';
import { HarnessDescriptorSchema } from './types.js';

interface OpenDotsAgentInfo {
  id: string;
  description?: string;
}

interface OpenDotsInfo {
  agents?: Record<string, unknown>;
  mode?: string;
}

interface AguiEvent {
  type?: string;
  threadId?: string;
  runId?: string;
  delta?: string;
  result?: unknown;
  message?: string;
}

interface RunAgentInput {
  threadId: string;
  runId: string;
  messages: Array<{ id: string; role: 'user'; content: string }>;
  tools: [];
  state: Record<string, unknown>;
  context: [];
  forwardedProps: Record<string, unknown>;
}

export interface OpenDotsConfig {
  baseUrl: string;
  agentId: string;
  token?: string;
  timeoutMs?: number;
}

export interface OpenDotsDiscovery {
  agents: OpenDotsAgentInfo[];
  mode?: string;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`OpenDots returned non-JSON response (HTTP ${response.status}).`);
  }
}

async function discover(config: OpenDotsConfig): Promise<OpenDotsDiscovery> {
  const response = await fetch(
    `${normalizeBaseUrl(config.baseUrl)}/api/copilotkit/info`,
    { headers: authHeaders(config.token) },
  );
  if (!response.ok) {
    throw new Error(`OpenDots discovery failed with HTTP ${response.status}.`);
  }

  const payload = (await readJson(response)) as OpenDotsInfo;
  const agents = Object.entries(payload.agents ?? {}).map(([id, value]) => ({
    id,
    description:
      typeof value === 'object' && value !== null && 'description' in value
        ? String((value as { description?: unknown }).description ?? '')
        : undefined,
  }));

  return { agents, mode: payload.mode };
}

async function readSse(
  response: Response,
  onEvent: (event: AguiEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error('OpenDots returned an empty event stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consume = (frame: string) => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;
    try {
      onEvent(JSON.parse(data) as AguiEvent);
    } catch {
      // Ignore non-JSON SSE frames; terminal AG-UI events remain JSON.
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) consume(frame);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
  } finally {
    reader.releaseLock();
  }
}

export class OpenDotsHarnessAdapter implements HarnessAdapter {
  readonly descriptor: HarnessDescriptor;
  private readonly config: OpenDotsConfig;
  private readonly controllers = new Map<string, AbortController>();
  private readonly threads = new Map<string, string>();
  private readonly requests = new Map<string, HarnessExecutionRequest>();

  constructor(config: OpenDotsConfig) {
    this.config = {
      ...config,
      baseUrl: normalizeBaseUrl(config.baseUrl),
      timeoutMs: config.timeoutMs ?? 120_000,
    };

    this.descriptor = HarnessDescriptorSchema.parse({
      id: `opendots:${config.agentId}`,
      name: `OpenDots (${config.agentId})`,
      kind: 'remote',
      provider: 'CopilotKit/OpenDots',
      capabilities: {
        codeGeneration: true,
        fileEditing: true,
        commandExecution: true,
        webResearch: true,
        communication: true,
        execution: true,
        local: false,
        remote: true,
        streaming: true,
        cancellation: true,
        checkpointResume: true,
        workspaceIsolation: true,
        multimodal: true,
        longContext: true,
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

  async detect(): Promise<HarnessAvailability> {
    try {
      const discovery = await discover(this.config);
      const found = discovery.agents.some((agent) => agent.id === this.config.agentId);
      return {
        installed: true,
        authenticated: true,
        executable: found,
        checkedAt: new Date().toISOString(),
        reason: found ? undefined : `Agent '${this.config.agentId}' was not advertised by OpenDots.`,
      };
    } catch (error) {
      return {
        installed: true,
        authenticated: !this.config.token,
        executable: false,
        checkedAt: new Date().toISOString(),
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async health(): Promise<HarnessHealth> {
    const availability = await this.detect();
    return {
      harnessId: this.descriptor.id,
      status: !availability.executable
        ? (availability.authenticated ? 'UNAVAILABLE' : 'AUTH_REQUIRED')
        : 'AVAILABLE',
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
    const startedAt = Date.now();
    this.requests.set(request.executionId, request);
    const threadId = this.threads.get(request.executionId) ?? `eamilos-${request.missionId}-${request.taskId}`;
    const runId = request.executionId;
    const controller = new AbortController();
    this.controllers.set(request.executionId, controller);

    const timeout = setTimeout(
      () => controller.abort(new Error('OpenDots execution timed out.')),
      Math.min(request.timeoutMs, this.config.timeoutMs ?? request.timeoutMs),
    );

    let output = '';
    let failed: { message: string } | undefined;
    let finished = false;

    const input: RunAgentInput = {
      threadId,
      runId,
      messages: [{
        id: randomUUID(),
        role: 'user',
        content: this.buildPrompt(request),
      }],
      tools: [],
      state: {
        missionId: request.missionId,
        taskId: request.taskId,
        executionId: request.executionId,
        acceptanceCriteria: request.context.acceptanceCriteria,
        readSet: request.resources.readSet,
        writeSet: request.resources.writeSet,
      },
      context: [],
      forwardedProps: {
        eamilos: {
          missionId: request.missionId,
          taskId: request.taskId,
          executionId: request.executionId,
          harnessId: request.harnessId,
        },
      },
    };

    try {
      const response = await fetch(
        `${this.config.baseUrl}/api/copilotkit/agent/${encodeURIComponent(this.config.agentId)}/run`,
        {
          method: 'POST',
          headers: {
            ...authHeaders(this.config.token),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const suffix = body && response.status < 500 ? `: ${body.slice(0, 300)}` : '';
        throw new Error(`OpenDots run failed with HTTP ${response.status}${suffix}`);
      }

      await readSse(response, (event) => {
        if (event.threadId) this.threads.set(request.executionId, event.threadId);
        if (event.type === 'TEXT_MESSAGE_CONTENT' && event.delta) {
          output += event.delta;
          onOutput?.(event.delta);
        }
        if (event.type === 'RUN_ERROR') failed = { message: event.message ?? 'OpenDots run failed.' };
        if (event.type === 'RUN_FINISHED') finished = true;
      });

      if (failed) {
        return this.result(request, startedAt, output, 'RECOVERABLE', {
          type: 'UNKNOWN',
          message: failed.message,
          retryable: true,
          fallbackEligible: true,
        });
      }

      if (!finished) {
        return this.result(request, startedAt, output, 'RECOVERABLE', {
          type: 'WORKER_LOST',
          message: 'OpenDots stream ended without RUN_FINISHED.',
          retryable: true,
          fallbackEligible: true,
        });
      }

      return this.result(request, startedAt, output, 'COMPLETED');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = controller.signal.aborted;
      return this.result(request, startedAt, output, aborted ? 'RECOVERABLE' : 'FAILED', {
        type: aborted ? 'TIMEOUT' : 'UNKNOWN',
        message,
        retryable: true,
        fallbackEligible: true,
      });
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(request.executionId);
    }
  }

  async cancel(executionId: string): Promise<void> {
    this.controllers.get(executionId)?.abort(new Error('Execution cancelled by EamilOS.'));
    const threadId = this.threads.get(executionId);
    if (!threadId) return;

    await fetch(
      `${this.config.baseUrl}/api/copilotkit/agent/${encodeURIComponent(this.config.agentId)}/stop/${encodeURIComponent(threadId)}`,
      {
        method: 'POST',
        headers: { ...authHeaders(this.config.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    ).catch(() => undefined);
  }

  async checkpoint(executionId: string): Promise<ExecutionCheckpoint> {
    const threadId = this.threads.get(executionId);
    if (!threadId) throw new Error(`No OpenDots thread exists for execution '${executionId}'.`);

    const request = this.requests.get(executionId);
    if (!request) throw new Error(`Execution '${executionId}' is not known to OpenDots adapter.`);

    return {
      id: `checkpoint_${executionId}`,
      missionId: request.missionId,
      taskId: request.taskId,
      executionId,
      harnessId: this.descriptor.id,
      nodeId: 'opendots',
      createdAt: new Date().toISOString(),
      progress: { completedSteps: [], remainingSteps: ['resume OpenDots thread'] },
      output: '',
      artifacts: [],
      resumeContext: 'Reconnect the OpenDots thread and continue from its persisted conversation state.',
      metadata: {
        provider: 'CopilotKit/OpenDots',
        threadId,
        agentId: this.config.agentId,
      },
    };
  }

  async resume(
    checkpoint: ExecutionCheckpoint,
    request: HarnessExecutionRequest,
    onOutput?: (chunk: string) => void,
  ): Promise<HarnessExecutionResult> {
    const threadId = typeof checkpoint.metadata.threadId === 'string'
      ? checkpoint.metadata.threadId
      : undefined;
    if (threadId) this.threads.set(request.executionId, threadId);
    return this.start(request, onOutput);
  }

  private buildPrompt(request: HarnessExecutionRequest): string {
    return [
      'EamilOS assignment. Execute only the assigned task.',
      `Mission: ${request.context.missionGoal}`,
      `Task: ${request.context.taskObjective}`,
      request.context.acceptanceCriteria.length
        ? `Acceptance criteria:\n${request.context.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}`
        : '',
      request.context.relevantFiles.length
        ? `Relevant files:\n${request.context.relevantFiles.map((item) => `- ${item}`).join('\n')}`
        : '',
      request.context.dependencies.length
        ? `Dependencies:\n${request.context.dependencies.map((item) => `- ${item}`).join('\n')}`
        : '',
      `Resources read: ${JSON.stringify(request.resources.readSet)}`,
      `Resources write: ${JSON.stringify(request.resources.writeSet)}`,
      request.context.checkpoint
        ? `Resume context: ${request.context.checkpoint.resumeContext ?? ''}`
        : '',
      request.prompt,
    ].filter(Boolean).join('\n\n');
  }

  private result(
    request: HarnessExecutionRequest,
    startedAt: number,
    output: string,
    status: HarnessExecutionResult['status'],
    error?: HarnessExecutionResult['error'],
  ): HarnessExecutionResult {
    const completedAt = new Date().toISOString();
    return {
      executionId: request.executionId,
      missionId: request.missionId,
      taskId: request.taskId,
      harnessId: request.harnessId,
      nodeId: 'opendots',
      status,
      output,
      artifacts: [],
      fileChanges: [],
      evidence: status === 'COMPLETED'
        ? ['opendots:run-finished', 'opendots:agent-stream']
        : [],
      validation: {
        passed: false,
        checks: [{
          name: 'opendots-run-finished',
          passed: status === 'COMPLETED',
          details: status === 'COMPLETED'
            ? 'OpenDots emitted RUN_FINISHED; this is execution evidence, not acceptance validation.'
            : error?.message,
        }],
      },
      error,
      metrics: {
        startedAt: new Date(startedAt).toISOString(),
        completedAt,
        durationMs: Date.now() - startedAt,
      },
    };
  }
}
