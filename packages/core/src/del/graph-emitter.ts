import { nanoid } from 'nanoid';
import {
  GraphStateManager,
  createGraphStateManager,
} from './graph-state.js';
import {
  GraphPersistence,
  getGraphPersistence,
} from './graph-persistence.js';
import { DELValidationError, DELErrorCode } from './types.js';
import { ClassifiedError, StageName } from './stateful-types.js';
import { NodeError, ExecutionNode, GraphEvent } from './graph-types.js';
import { getFailureType } from './failure-classifier.js';

export interface GraphEmitterConfig {
  persistEvents: boolean;
  autoFinalize: boolean;
}

const DEFAULT_CONFIG: GraphEmitterConfig = {
  persistEvents: true,
  autoFinalize: true,
};

export class GraphEmitter {
  private stateManager: GraphStateManager;
  private persistence: GraphPersistence;
  private config: GraphEmitterConfig;
  private stageStartTimes: Map<string, number> = new Map();

  constructor(
    sessionId: string,
    goal: string,
    config: Partial<GraphEmitterConfig> = {},
    persistence?: GraphPersistence
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.persistence = persistence || getGraphPersistence();
    this.stateManager = createGraphStateManager(sessionId, goal);

    if (this.config.persistEvents) {
      this.stateManager.subscribe(event => {
        this.persistence.appendEvent(sessionId, event);
      });
    }
  }

  getStateManager(): GraphStateManager {
    return this.stateManager;
  }

  getSessionId(): string {
    return this.stateManager.getSessionId();
  }

  onStageStart(stageName: StageName, metadata?: Record<string, unknown>): ExecutionNode {
    const startTime = Date.now();
    const nodeId = nanoid();
    this.stageStartTimes.set(nodeId, startTime);

    const label = formatStageLabel(stageName);

    return this.stateManager.createChildNode({
      label,
      type: 'stage',
      metadata: {
        stageName,
        ...metadata,
      },
    });
  }

  onStageComplete(
    nodeId: string,
    stageName: StageName,
    success: boolean,
    error?: DELValidationError,
    metadata?: Record<string, unknown>
  ): ExecutionNode | null {
    const startTime = this.stageStartTimes.get(nodeId);
    const durationMs = startTime ? Date.now() - startTime : undefined;
    this.stageStartTimes.delete(nodeId);

    const nodeError = error ? convertToNodeError(error) : undefined;

    const additionalMetadata: Record<string, unknown> = {
      stageName,
      ...metadata,
    };

    if (durationMs !== undefined) {
      additionalMetadata.durationMs = durationMs;
    }

    return this.stateManager.completeNode(
      nodeId,
      success,
      nodeError,
      durationMs
    );
  }

  onRetryDecision(
    parentFailedNodeId: string,
    attemptNumber: number,
    strategy: 'standard' | 'strict' | 'decompose',
    classifiedErrors?: ClassifiedError[]
  ): ExecutionNode {
    const retryNode = this.stateManager.createRetryBranch(
      parentFailedNodeId,
      attemptNumber,
      strategy
    );

    if (classifiedErrors && classifiedErrors.length > 0) {
      const primaryError = classifiedErrors[0];
      this.stateManager.updateNodeStatus(retryNode.id, 'running', undefined, {
        errorSummary: primaryError.message,
        errorCount: classifiedErrors.length,
      });
    }

    return retryNode;
  }

  onSecurityFailure(
    nodeId: string,
    _stageName: StageName,
    error: DELValidationError
  ): ExecutionNode | null {
    const nodeError = convertToNodeError(error);
    nodeError.retryable = false;
    nodeError.failureType = 'security_error';

    return this.stateManager.completeNode(nodeId, false, nodeError);
  }

  onExtractionSuccess(
    nodeId: string,
    strategy: string,
    fileCount: number
  ): ExecutionNode | null {
    return this.stateManager.updateNodeStatus(nodeId, 'success', undefined, {
      extractionStrategy: strategy,
      fileCount,
    });
  }

  onValidationSuccess(
    nodeId: string,
    stageName: string,
    fileCount: number,
    metadata?: Record<string, unknown>
  ): ExecutionNode | null {
    return this.stateManager.updateNodeStatus(nodeId, 'success', undefined, {
      stageName,
      fileCount,
      ...metadata,
    });
  }

  onContentValidationFailure(
    nodeId: string,
    placeholders: string[],
    codeDensity: number
  ): ExecutionNode | null {
    return this.stateManager.updateNodeStatus(
      nodeId,
      'failed',
      {
        code: 'PLACEHOLDER_DETECTED',
        message: `Placeholders detected: ${placeholders.join(', ')}`,
        failureType: 'content_error',
        retryable: true,
      },
      { placeholderCount: placeholders.length, codeDensity }
    );
  }

  onWriteSuccess(
    nodeId: string,
    filesWritten: number,
    bytesWritten: number
  ): ExecutionNode | null {
    return this.stateManager.updateNodeStatus(nodeId, 'success', undefined, {
      fileCount: filesWritten,
      bytesWritten,
    });
  }

  onPartialSuccess(
    successfulFiles: number,
    failedFiles: number,
    error?: DELValidationError
  ): ExecutionNode {
    const node = this.stateManager.createChildNode({
      label: `Partial Success: ${successfulFiles}/${successfulFiles + failedFiles} files`,
      type: 'decision',
      status: 'success',
      metadata: {
        successfulFiles,
        failedFiles,
      },
    });

    if (error) {
      this.stateManager.updateNodeStatus(node.id, 'success', undefined, {
        errorSummary: error.message,
      });
    }

    return node;
  }

  finalize(success: boolean): void {
    const rootNode = this.stateManager.getRootNode();
    this.stateManager.updateNodeStatus(rootNode.id, success ? 'success' : 'failed');
  }

  subscribe(listener: (event: GraphEvent) => void): () => void {
    return this.stateManager.subscribe(listener);
  }

  loadExistingSession(sessionId: string): boolean {
    const existingGraph = this.persistence.loadGraph(sessionId);
    if (!existingGraph) return false;

    const events = this.persistence.getEvents(sessionId);
    this.stateManager.replayEvents(events);
    return true;
  }
}

function convertToNodeError(error: DELValidationError): NodeError {
  return {
    code: error.code,
    message: error.message,
    failureType: getFailureType(error),
    retryable: !isSecurityError(error.code),
    context: error.context,
    filePath: error.filePath,
  };
}

function isSecurityError(code: DELErrorCode): boolean {
  return code === DELErrorCode.PATH_TRAVERSAL || code === DELErrorCode.SECRET_DETECTED;
}

function formatStageLabel(stageName: StageName): string {
  const labels: Record<StageName, string> = {
    normalization: 'Normalization',
    extraction: 'Extraction',
    schema: 'Schema Validation',
    content: 'Content Validation',
    security: 'Security Validation',
    partial_repair: 'Partial Repair',
    write: 'Atomic Write',
  };
  return labels[stageName] || stageName;
}

export function createGraphEmitter(
  sessionId: string,
  goal: string,
  config?: Partial<GraphEmitterConfig>,
  persistence?: GraphPersistence
): GraphEmitter {
  return new GraphEmitter(sessionId, goal, config, persistence);
}
