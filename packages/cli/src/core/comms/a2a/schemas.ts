import { z } from 'zod';
export {
  A2ATaskStateSchema,
  A2APartSchema,
  A2AMessageSchema,
  A2AArtifactSchema,
  A2ATaskSchema,
} from './types.js';

export const A2AAgentCardSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  version: z.string().min(1),
  url: z.string().url().optional(),
  capabilities: z.object({ streaming: z.boolean(), pushNotifications: z.boolean() }),
  skills: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()).optional(),
  })),
  authentication: z.object({ schemes: z.array(z.string()) }).optional(),
});
