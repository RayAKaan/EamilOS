import { ToolDefinition, WorkspaceReadArgsSchema, WorkspaceReadArgs } from './types.js';
import { getWorkspace } from '../workspace.js';
import { EamilOSError, ValidationError } from '../errors.js';
import { z } from 'zod';

export const workspaceReadTool: ToolDefinition = {
  name: 'workspace_read',
  description: 'Read the content of a file from the project workspace.',
  inputSchema: WorkspaceReadArgsSchema,
  outputSchema: z.object({
    success: z.boolean(),
    content: z.string(),
    size: z.number(),
  }),
  execute: async (args: unknown): Promise<{ success: boolean; content: string; size: number }> => {
    const parsed = WorkspaceReadArgsSchema.safeParse(args);
    if (!parsed.success) {
      throw new ValidationError(`Invalid workspace_read arguments: ${parsed.error.message}`);
    }

    const { projectId, filePath } = parsed.data as WorkspaceReadArgs;
    const workspace = getWorkspace();

    try {
      const content = workspace.readArtifact(projectId, filePath);
      return { success: true, content, size: Buffer.byteLength(content, 'utf-8') };
    } catch (error) {
      if (error instanceof EamilOSError) {
        throw error;
      }
      throw new EamilOSError(`Failed to read artifact: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};
