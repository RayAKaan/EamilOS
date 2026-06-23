import { PredictionSignals } from './prediction-types.js';
import { FailureType, StageName } from './stateful-types.js';
import { DELValidationError } from './types.js';

export interface SignalExtractionContext {
  sessionId: string;
  nodeId?: string;
  goal: string;
  targetModel: string;
  attempt: number;
  files?: Array<{ path: string; content: string }>;
  previousError?: DELValidationError;
  previousStrategy?: string;
}

const FILE_EXTENSION_REGEX = /\.([a-zA-Z0-9]+)(?:\?.*)?$/;

export function extractSignals(context: SignalExtractionContext): PredictionSignals {
  const fileExtensions = extractFileExtensions(context.files || []);
  const complexityScore = calculateComplexityScore(context.files || [], context.goal);
  const failureType = context.previousError ? mapErrorToFailureType(context.previousError) : undefined;
  const failureStage = context.previousError?.stage as StageName | undefined;

  return {
    sessionId: context.sessionId,
    nodeId: context.nodeId,
    goal: context.goal,
    failureType,
    failureStage,
    targetModel: context.targetModel,
    attempt: context.attempt,
    fileExtensions,
    complexityScore,
    previousStrategy: context.previousStrategy,
  };
}

export function extractFileExtensions(files: Array<{ path: string; content: string }>): string[] {
  const extensions = new Set<string>();

  for (const file of files) {
    const match = file.path.match(FILE_EXTENSION_REGEX);
    if (match) {
      extensions.add(`.${match[1].toLowerCase()}`);
    }
  }

  return Array.from(extensions).sort();
}

export function calculateComplexityScore(
  files: Array<{ path: string; content: string }>,
  goal: string
): number {
  const fileCount = files.length;
  const totalLines = files.reduce((sum, f) => sum + f.content.split('\n').length, 0);
  const avgFileSize = fileCount > 0 ? totalLines / fileCount : 0;

  const goalWordCount = goal.split(/\s+/).length;
  const goalComplexity = Math.min(goalWordCount / 100, 1);

  const fileCountScore = Math.min(fileCount / 20, 1) * 0.3;
  const fileSizeScore = Math.min(avgFileSize / 500, 1) * 0.4;
  const goalScore = goalComplexity * 0.3;

  return Math.min(fileCountScore + fileSizeScore + goalScore, 1.0);
}

function mapErrorToFailureType(error: DELValidationError): FailureType {
  const code = error.code;

  switch (code) {
    case 'EXTRACTION_FAILURE':
      return 'format_error';
    case 'SCHEMA_MISMATCH':
      return 'schema_error';
    case 'PLACEHOLDER_DETECTED':
    case 'LOW_CODE_DENSITY':
      return 'content_error';
    case 'PATH_TRAVERSAL':
    case 'SECRET_DETECTED':
      return 'security_error';
    case 'SYNTAX_ERROR':
      return 'content_error';
    default:
      return 'format_error';
  }
}

export function calculateContextSimilarity(
  signals: PredictionSignals,
  historical: {
    failureType?: FailureType;
    targetModel: string;
    fileExtensions: string[];
  }
): number {
  let score = 0;
  let factors = 0;

  if (signals.failureType && historical.failureType) {
    factors++;
    if (signals.failureType === historical.failureType) {
      score += 0.4;
    }
  }

  if (signals.targetModel === historical.targetModel) {
    score += 0.3;
    factors++;
  } else {
    factors++;
  }

  if (signals.fileExtensions.length > 0 && historical.fileExtensions.length > 0) {
    const overlap = signals.fileExtensions.filter(ext =>
      historical.fileExtensions.includes(ext)
    ).length;
    const union = new Set([...signals.fileExtensions, ...historical.fileExtensions]).size;
    score += (overlap / union) * 0.3;
    factors++;
  } else {
    factors++;
  }

  return factors > 0 ? score / factors : 0;
}

export function getSignalFingerprint(signals: PredictionSignals): string {
  const parts = [
    signals.targetModel,
    signals.failureType || 'none',
    signals.fileExtensions.sort().join(','),
    signals.attempt.toString(),
  ];
  return parts.join('|');
}
