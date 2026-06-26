import type { ExecutionStrategy, AgentMode, AgentResponse, ProposedFileChange } from '../agents/types.js';
import type { FileChange } from '../changes/ChangeCollector.js';

export interface SessionEventMap {
  'session.started': { goal: string; strategy: ExecutionStrategy; mode: AgentMode };
  'agent.started': { agentId: string };
  'agent.output': { agentId: string; content: string };
  'agent.fallback': { from: string; to: string; reason: string };
  'agent.completed': { agentId: string; result: AgentResponse };
  'agent.error': { agentId: string; error: string; errorType?: string };
  'file.proposed': { file: ProposedFileChange };
  'validation.started': {};
  'validation.passed': {};
  'validation.failed': { errors: string[] };
  'changes.collected': { changes: FileChange[] };
  'changes.applied': { applied: string[]; failed: { path: string; error: string }[] };
  'staging.cleaned': { sessionId: string };
  'session.completed': { success: boolean; duration: number };
  'session.error': { error: string };
}
