import type { AgentRuntimeRateLimitDto } from "../../../../../shared/contracts/agent-runtime.ts";

export interface StructuredUsagePayload {
  inputTokens?: number;
  outputTokens?: number;
  contextWindow?: number;
  totalTokens?: number;
  rateLimits?: AgentRuntimeRateLimitDto[];
}

export function usageWithRememberedRateLimits(
  usage: StructuredUsagePayload | undefined,
  rememberedRateLimits: AgentRuntimeRateLimitDto[] | undefined,
): StructuredUsagePayload | undefined {
  const rateLimits =
    usage?.rateLimits !== undefined && usage.rateLimits.length > 0
      ? usage.rateLimits
      : rememberedRateLimits;
  if (usage === undefined && rateLimits === undefined) {
    return undefined;
  }
  return {
    ...(usage ?? {}),
    ...(rateLimits !== undefined ? { rateLimits } : {}),
  };
}
