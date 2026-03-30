import { z } from 'zod';

export const ArtifactTypeEnum = z.enum([
  'code',
  'doc',
  'config',
  'data',
  'report',
  'test',
  'design',
  'other',
]);

export type ArtifactType = z.infer<typeof ArtifactTypeEnum>;

export const ArtifactSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
  hash: z.string().min(1),
  size: z.number().int().min(0),
  type: ArtifactTypeEnum,
  createdBy: z.string().min(1),
  version: z.number().int().min(1).default(1),
  description: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

export interface ArtifactCreate {
  projectId: string;
  taskId: string;
  path: string;
  content: string;
  hash: string;
  size: number;
  type: ArtifactType;
  createdBy: string;
  description?: string;
}

export interface ArtifactInfo {
  path: string;
  size: number;
  createdBy: string;
  createdAt: Date;
}
