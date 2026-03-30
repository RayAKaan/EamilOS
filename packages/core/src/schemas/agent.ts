import { z } from 'zod';

export const AgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  source: z.enum(['prebuilt', 'custom', 'external']).default('prebuilt'),
  systemPrompt: z.string().min(1),
  capabilities: z.array(z.string()).min(1),
  preferredTier: z.enum(['cheap', 'strong']),
  tools: z.array(z.string()),
  maxTokens: z.number().int().min(1).default(4096),
  temperature: z.number().min(0).max(2).default(0.2),
  permissions: z.object({
    fileRead: z.boolean().default(true),
    fileWrite: z.boolean().default(true),
    fileDelete: z.boolean().default(false),
    commandExecute: z.boolean().default(false),
    networkRead: z.boolean().default(false),
    networkWrite: z.boolean().default(false),
  }).default({}),
  timeoutSeconds: z.number().int().min(1).default(300),
  maxRetries: z.number().int().min(0).default(3),
});

export type AgentDefinition = z.infer<typeof AgentSchema>;

export interface AgentPermissions {
  fileRead: boolean;
  fileWrite: boolean;
  fileDelete: boolean;
  commandExecute: boolean;
  networkRead: boolean;
  networkWrite: boolean;
}
