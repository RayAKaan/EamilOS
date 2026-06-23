import { ToolDefinition, WorkspaceListArgsSchema, WorkspaceListArgs } from './types.js';
import { getWorkspace } from '../workspace.js';
import { EamilOSError, ValidationError } from '../errors.js';
import { z } from 'zod';

export const workspaceListTool: ToolDefinition = {
  name: 'workspace_list',
  description: 'List all files in the project workspace.',
  inputSchema: WorkspaceListArgsSchema,
  outputSchema: z.object({
    success: z.boolean(),
    files: z.array(
      z.object({
        path: z.string(),
        size: z.number(),
        createdBy: z.string(),
        createdAt: z.string(),
      })
    ),
    totalFiles: z.number(),
    totalSize: z.number(),
  }),
  execute: async (args: unknown): Promise<{
    success: boolean;
    files: Array<{ path: string; size: number; createdBy: string; createdAt: string }>;
    totalFiles: number;
    totalSize: number;
  }> => {
    const parsed = WorkspaceListArgsSchema.safeParse(args);
    if (!parsed.success) {
      throw new ValidationError(`Invalid workspace_list arguments: ${parsed.error.message}`);
    }

    const { projectId } = parsed.data as WorkspaceListArgs;
    const workspace = getWorkspace();

    try {
      const files = workspace.listFiles(projectId);
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);

      return {
        success: true,
        files: files.map((f) => ({
          path: f.path,
          size: f.size,
          createdBy: f.createdBy,
          createdAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : String(f.createdAt),
        })),
        totalFiles: files.length,
        totalSize,
      };
    } catch (error) {
      if (error instanceof EamilOSError) {
        throw error;
      }
      throw new EamilOSError(`Failed to list files: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};
