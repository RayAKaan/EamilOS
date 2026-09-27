import type { HarnessAdapter } from './HarnessAdapter.js';
import type {
  HarnessExecutionRequest,
  HarnessExecutionResult,
} from './types.js';

export class ExecutionSupervisor {
  async run(
    adapter: HarnessAdapter,
    request: HarnessExecutionRequest,
    onOutput?: (chunk: string) => void,
  ): Promise<HarnessExecutionResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;

    const timeoutResult = new Promise<HarnessExecutionResult>((resolve) => {
      timer = setTimeout(async () => {
        timedOut = true;
        try {
          await adapter.cancel(request.executionId);
        } catch {
          // Cancellation is best effort. The execution is still considered timed out.
        }

        const now = new Date().toISOString();
        resolve({
          executionId: request.executionId,
          missionId: request.missionId,
          taskId: request.taskId,
          harnessId: request.harnessId,
          nodeId: request.nodeId,
          status: 'TIMED_OUT',
          artifacts: [],
          fileChanges: [],
          evidence: [],
          error: {
            type: 'TIMEOUT',
            message: `Execution exceeded timeout of ${request.timeoutMs}ms`,
            retryable: true,
            fallbackEligible: true,
          },
          metrics: {
            startedAt: now,
            completedAt: now,
            durationMs: request.timeoutMs,
          },
        });
      }, request.timeoutMs);
    });

    try {
      const result = await Promise.race([
        adapter.start(request, onOutput),
        timeoutResult,
      ]);
      return timedOut ? result : result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
