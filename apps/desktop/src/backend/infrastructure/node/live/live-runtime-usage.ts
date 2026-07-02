import type { AgentRuntimeUsageDto } from "../../../../shared/contracts/index.ts";

export interface StructuredRuntimeUsageInput {
  inputTokens?: number;
  outputTokens?: number;
  contextTokens?: number;
  contextWindow?: number;
  totalTokens?: number;
  rateLimits?: AgentRuntimeUsageDto["rateLimits"];
}

export function runtimeUsageFromStructuredUsage(
  input: StructuredRuntimeUsageInput,
): AgentRuntimeUsageDto | undefined {
  const totalTokens =
    input.totalTokens ??
    (input.inputTokens !== undefined && input.outputTokens !== undefined
      ? input.inputTokens + input.outputTokens
      : undefined);
  const contextTokens = input.contextTokens ?? totalTokens;
  const rateLimits =
    input.rateLimits !== undefined && input.rateLimits.length > 0
      ? input.rateLimits
      : undefined;
  if (totalTokens === undefined && contextTokens === undefined && rateLimits === undefined) {
    return undefined;
  }

  const usage: AgentRuntimeUsageDto = {};
  if (totalTokens !== undefined) {
    usage.totalTokens = totalTokens;
  }
  if (contextTokens !== undefined) {
    usage.contextTokens = contextTokens;
  }
  if (input.contextWindow !== undefined) {
    usage.contextWindow = input.contextWindow;
  }
  if (rateLimits !== undefined) {
    usage.rateLimits = rateLimits;
  }
  if (contextTokens !== undefined && input.contextWindow !== undefined && input.contextWindow > 0) {
    usage.contextUsedPercent = Math.min(100, Math.round((contextTokens / input.contextWindow) * 100));
  }
  return usage;
}
