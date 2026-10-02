import type { AgentRequest } from '../types.js';
import type { UniversalAgentDefinition } from './types.js';

export type PromptDelivery = 'interactive-stdin' | 'argv' | 'env' | 'none';

export interface AgentLaunchContract {
  executable: string;
  args: string[];
  promptDelivery: PromptDelivery;
  promptEnv?: string;
  interactive: boolean;
  headless: boolean;
  supportsInterrupt: boolean;
  supportsResume: boolean;
}

export function resolveExecutable(definition: UniversalAgentDefinition, detectedExecutable?: string): string {
  return detectedExecutable ?? definition.executableCandidates[0] ?? definition.id;
}

export function createLaunchContract(
  definition: UniversalAgentDefinition,
  request: AgentRequest,
  detectedExecutable?: string,
): AgentLaunchContract {
  const executable = resolveExecutable(definition, detectedExecutable);
  const args = definition.runArgs ? definition.runArgs(request.prompt) : [];
  return {
    executable,
    args,
    promptDelivery: args.length ? 'argv' : definition.promptDelivery ?? 'interactive-stdin',
    promptEnv: definition.promptEnv,
    interactive: request.mode !== 'communication' || definition.capabilities.interactive,
    headless: definition.capabilities.headless,
    supportsInterrupt: true,
    supportsResume: definition.capabilities.resumeSessions,
  };
}
