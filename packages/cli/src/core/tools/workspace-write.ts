import { z } from 'zod';
import { ToolDefinition, WorkspaceWriteArgsSchema, WorkspaceWriteArgs } from './types.js';
import { getWorkspace } from '../workspace.js';
import { EamilOSError, ValidationError } from '../errors.js';
import { getCodeValidator } from '../validation/code-validator.js';

export const workspaceWriteTool: ToolDefinition = {
  name: 'workspace_write',
  description: 'Write content to a file in the project workspace. Creates parent directories if needed.',
  inputSchema: WorkspaceWriteArgsSchema,
  outputSchema: WorkspaceWriteArgsSchema.extend({
    success: z.boolean(),
    hash: z.string(),
    validationErrors: z.array(z.object({
      line: z.number().optional(),
      message: z.string(),
    })).optional(),
  }),
  execute: async (args: unknown): Promise<{ success: boolean; hash: string; validationErrors?: Array<{ line?: number; message: string }> }> => {
    const parsed = WorkspaceWriteArgsSchema.safeParse(args);
    if (!parsed.success) {
      throw new ValidationError(`Invalid workspace_write arguments: ${parsed.error.message}`);
    }

    const { projectId, filePath, content } = parsed.data as WorkspaceWriteArgs;
    const workspace = getWorkspace();

    const validator = getCodeValidator();
    const validation = validator.validate(content, filePath);

    if (!validation.valid) {
      const errorMessages = validation.errors.map(e => 
        e.line ? `Line ${e.line}: ${e.message}` : e.message
      );
      throw new ValidationError(`Code validation failed for ${filePath}: ${errorMessages.join('; ')}`);
    }

    try {
      workspace.writeArtifact(projectId, filePath, content);
      const hash = workspace.computeHash(content);
      return { 
        success: true, 
        hash,
        validationErrors: validation.warnings.length > 0 
          ? validation.warnings.map(w => ({ line: w.line, message: w.message }))
          : undefined
      };
    } catch (error) {
      if (error instanceof EamilOSError) {
        throw error;
      }
      throw new EamilOSError(`Failed to write artifact: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};
