import { ToolDefinition, LogDecisionArgsSchema, LogDecisionArgs } from './types.js';
import { getDatabase } from '../db.js';
import { ValidationError } from '../errors.js';
import { z } from 'zod';

export const logDecisionTool: ToolDefinition = {
  name: 'log_decision',
  description: 'Log an agent decision for audit trail and future reference.',
  inputSchema: LogDecisionArgsSchema,
  outputSchema: z.object({
    success: z.boolean(),
    eventId: z.string(),
  }),
  execute: async (args: unknown): Promise<{ success: boolean; eventId: string }> => {
    const parsed = LogDecisionArgsSchema.safeParse(args);
    if (!parsed.success) {
      throw new ValidationError(`Invalid log_decision arguments: ${parsed.error.message}`);
    }

    const { projectId, taskId, decision, rationale, metadata } = parsed.data as LogDecisionArgs;
    const db = getDatabase();

    const event = db.createEvent({
      type: 'decision.made',
      projectId,
      taskId,
      data: {
        decision,
        rationale: rationale ?? null,
        metadata: metadata ?? null,
      },
      humanReadable: `Agent decision: ${decision.substring(0, 50)}${decision.length > 50 ? '...' : ''}`,
    });

    return { success: true, eventId: event.id };
  },
};
