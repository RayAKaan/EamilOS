import { z } from 'zod';

export const WorkspaceWriteArgsSchema = z.object({
  projectId: z.string(),
  filePath: z.string(),
  content: z.string(),
});

export type WorkspaceWriteArgs = z.infer<typeof WorkspaceWriteArgsSchema>;

export const WorkspaceReadArgsSchema = z.object({
  projectId: z.string(),
  filePath: z.string(),
});

export type WorkspaceReadArgs = z.infer<typeof WorkspaceReadArgsSchema>;

export const WorkspaceListArgsSchema = z.object({
  projectId: z.string(),
  pattern: z.string().optional(),
});

export type WorkspaceListArgs = z.infer<typeof WorkspaceListArgsSchema>;

export const LogDecisionArgsSchema = z.object({
  projectId: z.string(),
  taskId: z.string(),
  decision: z.string(),
  rationale: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type LogDecisionArgs = z.infer<typeof LogDecisionArgsSchema>;

export const ExecuteCommandArgsSchema = z.object({
  projectId: z.string(),
  command: z.string(),
  workingDir: z.string().optional(),
  timeout: z.number().optional(),
  env: z.record(z.string()).optional(),
});

export type ExecuteCommandArgs = z.infer<typeof ExecuteCommandArgsSchema>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  outputSchema: z.ZodType<unknown>;
  execute: (args: unknown) => Promise<unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export type ToolRegistry = Map<string, ToolDefinition>;
