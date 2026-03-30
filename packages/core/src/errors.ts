export class EamilOSError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'EamilOSError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends EamilOSError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class ConfigurationError extends EamilOSError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIGURATION_ERROR', details);
    this.name = 'ConfigurationError';
  }
}

export class DatabaseError extends EamilOSError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DATABASE_ERROR', details);
    this.name = 'DatabaseError';
  }
}

export class WorkspaceError extends EamilOSError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'WORKSPACE_ERROR', details);
    this.name = 'WorkspaceError';
  }
}

export class PathTraversalError extends WorkspaceError {
  constructor(message: string) {
    super(message, { code: 'PATH_TRAVERSAL' });
    this.name = 'PathTraversalError';
  }
}

export class FileSizeLimitError extends WorkspaceError {
  constructor(message: string, public readonly fileSize: number, public readonly limit: number) {
    super(message, { fileSize, limit });
    this.name = 'FileSizeLimitError';
  }
}

export class TaskError extends EamilOSError {
  constructor(message: string, public readonly taskId?: string, details?: Record<string, unknown>) {
    super(message, 'TASK_ERROR', { taskId, ...details });
    this.name = 'TaskError';
  }
}

export class TaskNotFoundError extends TaskError {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`, taskId, { code: 'TASK_NOT_FOUND' });
    this.name = 'TaskNotFoundError';
  }
}

export class InvalidTaskStateError extends TaskError {
  constructor(
    taskId: string,
    public readonly currentState: string,
    public readonly attemptedState: string
  ) {
    super(
      `Invalid task state transition: ${currentState} -> ${attemptedState}`,
      taskId,
      { currentState, attemptedState }
    );
    this.name = 'InvalidTaskStateError';
  }
}

export class CircularDependencyError extends TaskError {
  constructor(public readonly cycleTasks: string[]) {
    super(`Circular dependency detected: ${cycleTasks.join(' -> ')}`, undefined, { cycleTasks });
    this.name = 'CircularDependencyError';
  }
}

export class DependencyNotMetError extends TaskError {
  constructor(taskId: string, public readonly unmetDependencies: string[]) {
    super(
      `Task ${taskId} has unmet dependencies: ${unmetDependencies.join(', ')}`,
      taskId,
      { unmetDependencies }
    );
    this.name = 'DependencyNotMetError';
  }
}

export class ProjectError extends EamilOSError {
  constructor(message: string, public readonly projectId?: string, details?: Record<string, unknown>) {
    super(message, 'PROJECT_ERROR', { projectId, ...details });
    this.name = 'ProjectError';
  }
}

export class ProjectNotFoundError extends ProjectError {
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`, projectId, { code: 'PROJECT_NOT_FOUND' });
    this.name = 'ProjectNotFoundError';
  }
}

export class BudgetExceededError extends ProjectError {
  constructor(projectId: string, public readonly spent: number, public readonly limit: number) {
    super(`Budget exceeded: spent $${spent.toFixed(4)}, limit $${limit.toFixed(4)}`, projectId, {
      spent,
      limit,
    });
    this.name = 'BudgetExceededError';
  }
}

export class ProviderError extends EamilOSError {
  constructor(
    message: string,
    public readonly provider?: string,
    public readonly model?: string,
    details?: Record<string, unknown>
  ) {
    super(message, 'PROVIDER_ERROR', { provider, model, ...details });
    this.name = 'ProviderError';
  }
}

export class ProviderNotAvailableError extends ProviderError {
  constructor(provider: string) {
    super(`Provider not available: ${provider}`, provider, undefined, { code: 'PROVIDER_NOT_AVAILABLE' });
    this.name = 'ProviderNotAvailableError';
  }
}

export class ModelNotFoundError extends ProviderError {
  constructor(model: string, provider?: string) {
    super(`Model not found: ${model}`, provider, model, { code: 'MODEL_NOT_FOUND' });
    this.name = 'ModelNotFoundError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(provider: string, public readonly retryAfterMs?: number) {
    super(`Rate limit exceeded for provider: ${provider}`, provider, undefined, {
      retryAfterMs,
    });
    this.name = 'RateLimitError';
  }
}

export class AgentError extends EamilOSError {
  constructor(message: string, public readonly agentType?: string, details?: Record<string, unknown>) {
    super(message, 'AGENT_ERROR', { agentType, ...details });
    this.name = 'AgentError';
  }
}

export class AgentNotFoundError extends AgentError {
  constructor(agentName: string) {
    super(`Agent not found: ${agentName}`, undefined, { agentName });
    this.name = 'AgentNotFoundError';
  }
}

export class ToolError extends EamilOSError {
  constructor(message: string, public readonly toolName?: string, details?: Record<string, unknown>) {
    super(message, 'TOOL_ERROR', { toolName, ...details });
    this.name = 'ToolError';
  }
}

export class ToolNotFoundError extends ToolError {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`, toolName, { code: 'TOOL_NOT_FOUND' });
    this.name = 'ToolNotFoundError';
  }
}

export class ToolExecutionError extends ToolError {
  constructor(toolName: string, public readonly cause?: string) {
    super(`Tool execution failed: ${toolName}`, toolName, { cause });
    this.name = 'ToolExecutionError';
  }
}

export class ToolTimeoutError extends ToolError {
  constructor(toolName: string, public readonly timeoutMs: number) {
    super(`Tool timed out: ${toolName} (${timeoutMs}ms)`, toolName, { timeoutMs });
    this.name = 'ToolTimeoutError';
  }
}

export class PermissionError extends EamilOSError {
  constructor(message: string, public readonly permission?: string, details?: Record<string, unknown>) {
    super(message, 'PERMISSION_ERROR', { permission, ...details });
    this.name = 'PermissionError';
  }
}

export class SecurityError extends EamilOSError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SECURITY_ERROR', details);
    this.name = 'SecurityError';
  }
}

export class ArtifactValidationError extends EamilOSError {
  constructor(
    message: string,
    public readonly taskId?: string,
    public readonly artifacts?: string[],
    details?: Record<string, unknown>
  ) {
    super(message, 'ARTIFACT_VALIDATION_ERROR', { taskId, artifacts, ...details });
    this.name = 'ArtifactValidationError';
  }
}

export class ContextSizeError extends EamilOSError {
  constructor(
    message: string,
    public readonly tokenCount?: number,
    public readonly maxTokens?: number
  ) {
    super(message, 'CONTEXT_SIZE_ERROR', { tokenCount, maxTokens });
    this.name = 'ContextSizeError';
  }
}

export function isEamilOSError(error: unknown): error is EamilOSError {
  return error instanceof EamilOSError;
}

export function getErrorCode(error: unknown): string | undefined {
  if (error instanceof EamilOSError) {
    return error.code;
  }
  if (error instanceof Error) {
    return 'UNKNOWN_ERROR';
  }
  return undefined;
}

export function getErrorDetails(error: unknown): Record<string, unknown> | undefined {
  if (error instanceof EamilOSError) {
    return error.details;
  }
  return undefined;
}
