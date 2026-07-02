import {
  CONTRACT_VERSION,
  type BackendEventEnvelope,
  type BackendEventId,
  type AgentRuntimeUsageDto,
  type ProviderCliAgentId,
} from "../../../../shared/contracts/index.ts";
import { runtimeUsageFromStructuredUsage, type StructuredRuntimeUsageInput } from "./live-runtime-usage.ts";

// Token usage reported natively by a structured protocol turn (claude result
// modelUsage; codex thread/tokenUsage/updated; ACP _meta.quota).
export function emitStructuredUsage(input: {
  threadId: string;
  agentId: ProviderCliAgentId;
  usage: StructuredRuntimeUsageInput;
  nextEventId: () => BackendEventId;
  onEvent?: (event: BackendEventEnvelope) => void;
}): AgentRuntimeUsageDto | undefined {
  const usage = runtimeUsageFromStructuredUsage(input.usage);
  if (usage === undefined) {
    return undefined;
  }
  input.onEvent?.({
    contractVersion: CONTRACT_VERSION,
    eventId: input.nextEventId(),
    kind: "agentRuntime.usageChanged",
    emittedAt: new Date().toISOString(),
    payload: {
      threadId: input.threadId,
      usage,
    },
  });
  if ((usage.rateLimits?.length ?? 0) > 0) {
    input.onEvent?.({
      contractVersion: CONTRACT_VERSION,
      eventId: input.nextEventId(),
      kind: "providerUsage.changed",
      emittedAt: new Date().toISOString(),
      payload: {
        usages: [
          {
            agentId: input.agentId,
            usage,
          },
        ],
      },
    });
  }
  return usage;
}

// Live fan-out activity (Claude subagent counts); an all-undefined activity clears it.
export function emitStructuredActivity(input: {
  threadId: string;
  activity: { nestedAgents?: number; nestedToolCalls?: number; planTotal?: number; planCompleted?: number };
  nextEventId: () => BackendEventId;
  onEvent?: (event: BackendEventEnvelope) => void;
}): void {
  input.onEvent?.({
    contractVersion: CONTRACT_VERSION,
    eventId: input.nextEventId(),
    kind: "agentRuntime.activityChanged",
    emittedAt: new Date().toISOString(),
    payload: { threadId: input.threadId, activity: input.activity },
  });
}
