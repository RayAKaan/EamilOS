import {
  EamilOSError,
  ValidationError,
  ConfigurationError,
  DatabaseError,
  WorkspaceError,
  PathTraversalError,
  FileSizeLimitError,
  TaskError,
  TaskNotFoundError,
  InvalidTaskStateError,
  CircularDependencyError,
  DependencyNotMetError,
  ProjectError,
  ProjectNotFoundError,
  BudgetExceededError,
  ProviderError,
  ProviderNotAvailableError,
  ModelNotFoundError,
  RateLimitError,
  AgentError,
  AgentNotFoundError,
  ToolError,
  ToolNotFoundError,
  ToolExecutionError,
  ToolTimeoutError,
  PermissionError,
  SecurityError,
  ArtifactValidationError,
  ContextSizeError,
} from './errors.js';
import { getLogger } from './logger.js';

export interface ErrorContext {
  taskId?: string;
  projectId?: string;
  agentType?: string;
  toolName?: string;
  correlationId?: string;
}

export type ErrorHandler = (error: Error, context: ErrorContext) => void | Promise<void>;

export class ErrorHandlerRegistry {
  private handlers: Map<string, ErrorHandler[]> = new Map();
  private static instance: ErrorHandlerRegistry | null = null;

  static getInstance(): ErrorHandlerRegistry {
    if (!ErrorHandlerRegistry.instance) {
      ErrorHandlerRegistry.instance = new ErrorHandlerRegistry();
    }
    return ErrorHandlerRegistry.instance;
  }

  register(errorType: string, handler: ErrorHandler): void {
    const existing = this.handlers.get(errorType) ?? [];
    this.handlers.set(errorType, [...existing, handler]);
  }

  handle(error: Error, context: ErrorContext = {}): void {
    const logger = getLogger();

    if (error instanceof EamilOSError) {
      logger.error(`[${error.name}] ${error.message}`, context);

      if (error.details) {
        logger.debug('Error details:', error.details);
      }
    } else {
      logger.error(`[Error] ${error.message}`, context);
    }

    const handlers = this.handlers.get(error.constructor.name) ?? [];
    const wildcardHandlers = this.handlers.get('*') ?? [];
    const allHandlers = [...handlers, ...wildcardHandlers];

    for (const handler of allHandlers) {
      try {
        handler(error, context);
      } catch (handlerError) {
        logger.error('Error in error handler', { metadata: { handlerError: String(handlerError) } });
      }
    }
  }
}

export function handleError(error: Error, context?: ErrorContext): void {
  ErrorHandlerRegistry.getInstance().handle(error, context);
}

export function registerErrorHandler(errorType: string, handler: ErrorHandler): void {
  ErrorHandlerRegistry.getInstance().register(errorType, handler);
}

export function createErrorContext(partial: Partial<ErrorContext>): ErrorContext {
  return {
    taskId: partial.taskId,
    projectId: partial.projectId,
    agentType: partial.agentType,
    toolName: partial.toolName,
    correlationId: partial.correlationId,
  };
}

export function formatError(error: unknown): string {
  if (error instanceof EamilOSError) {
    let message = `[${error.name}] ${error.message}`;
    if (error.code) {
      message += ` (${error.code})`;
    }
    return message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function getRetryableError(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof ProviderNotAvailableError) return true;
  if (error instanceof ToolTimeoutError) return true;

  if (error instanceof EamilOSError) {
    return error.code === 'RATE_LIMIT' || error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR';
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('rate limit') ||
      message.includes('network') ||
      message.includes('connection')
    );
  }

  return false;
}

export {
  EamilOSError,
  ValidationError,
  ConfigurationError,
  DatabaseError,
  WorkspaceError,
  PathTraversalError,
  FileSizeLimitError,
  TaskError,
  TaskNotFoundError,
  InvalidTaskStateError,
  CircularDependencyError,
  DependencyNotMetError,
  ProjectError,
  ProjectNotFoundError,
  BudgetExceededError,
  ProviderError,
  ProviderNotAvailableError,
  ModelNotFoundError,
  RateLimitError,
  AgentError,
  AgentNotFoundError,
  ToolError,
  ToolNotFoundError,
  ToolExecutionError,
  ToolTimeoutError,
  PermissionError,
  SecurityError,
  ArtifactValidationError,
  ContextSizeError,
};
