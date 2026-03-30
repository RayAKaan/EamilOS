import { z } from 'zod';

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.unknown()),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
