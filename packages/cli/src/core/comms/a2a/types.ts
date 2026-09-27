import { z } from 'zod';

export const A2ATaskStateSchema = z.enum(['submitted','working','input-required','completed','failed','canceled']);
export type A2ATaskState = z.infer<typeof A2ATaskStateSchema>;

export const A2APartSchema = z.object({
  kind: z.enum(['text','data','file','artifact']),
  text: z.string().optional(),
  data: z.unknown().optional(),
  uri: z.string().optional(),
  mimeType: z.string().optional(),
});
export type A2APart = z.infer<typeof A2APartSchema>;

export const A2AMessageSchema = z.object({
  messageId: z.string().min(1),
  role: z.enum(['user','agent']),
  parts: z.array(A2APartSchema),
  metadata: z.record(z.unknown()).default({}),
});
export type A2AMessage = z.infer<typeof A2AMessageSchema>;

export const A2AArtifactSchema = z.object({
  artifactId: z.string().min(1),
  name: z.string().min(1),
  parts: z.array(A2APartSchema),
  metadata: z.record(z.unknown()).default({}),
});
export type A2AArtifact = z.infer<typeof A2AArtifactSchema>;

export const A2ATaskSchema = z.object({
  id: z.string().min(1),
  contextId: z.string().min(1),
  state: A2ATaskStateSchema,
  messages: z.array(A2AMessageSchema),
  artifacts: z.array(A2AArtifactSchema),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type A2ATask = z.infer<typeof A2ATaskSchema>;

export interface A2AAgentCard {
  name: string;
  description: string;
  version: string;
  url?: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  skills: { id: string; name: string; description: string; tags?: string[] }[];
  authentication?: { schemes: string[] };
}

export interface A2ATransport {
  readonly id: string;
  send(card: A2AAgentCard, task: A2ATask): Promise<A2ATask>;
  health?(): Promise<{ healthy: boolean; error?: string }>;
}

export interface A2AClient {
  discover(url: string): Promise<A2AAgentCard>;
  sendTask(url: string, task: A2ATask): Promise<A2ATask>;
  getTask(url: string, taskId: string): Promise<A2ATask>;
  cancelTask(url: string, taskId: string): Promise<A2ATask>;
}
