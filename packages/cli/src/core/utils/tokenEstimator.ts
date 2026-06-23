/**
 * Token estimation utility
 * Provides a rough estimate for token counting without external dependencies
 */

export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(messages: Array<{ role: string; content: string }>): number {
  const overhead = 4;
  let total = 0;

  for (const msg of messages) {
    total += estimateTokens(msg.content) + overhead;
  }

  total += 3;
  return total;
}

export function estimateResponseTokens(estimatedResponseLength: number): number {
  return Math.ceil(estimatedResponseLength / 4);
}

export interface TokenEstimate {
  promptTokens: number;
  maxCompletionTokens: number;
  totalEstimate: number;
}

export function estimateRequestTokens(
  messages: Array<{ role: string; content: string }>,
  maxTokens?: number
): TokenEstimate {
  const promptTokens = estimateMessageTokens(messages);
  const maxCompletionTokens = maxTokens || 1000;
  const totalEstimate = promptTokens + maxCompletionTokens;

  return {
    promptTokens,
    maxCompletionTokens,
    totalEstimate,
  };
}

export { formatTokenCount } from "./format.js";
