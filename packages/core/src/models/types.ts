export interface PreflightTestResult {
  testName: string;
  passed: boolean;
  responseTimeMs: number;
  details: string;
}

export interface ModelProfile {
  name: string;
  provider: string;
  supportsTools: boolean;
  supportsJSON: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
  reliabilityScore: number;
  jsonComplianceRate: number;
  avgResponseTimeMs: number;
  testedAt: string;
  testResults: PreflightTestResult[];
}

export interface ExecutionStrategy {
  mode: 'tool' | 'json_strict' | 'json_nuclear';
  promptStrictness: 'normal' | 'strict' | 'nuclear';
  maxRetries: number;
  retryDelayMs: number;
  requiresTaskSplitting: boolean;
  maxTaskSizeChars: number;
  systemPrompt: string;
}
