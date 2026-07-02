import type { AgentSessionBlock } from "../../../application/domains/agent-session/agent-session-block.ts";
import type { ThreadRuntimeService } from "../../../application/services/thread/thread-runtime-service.ts";
import { createAgentSessionBlockUpsertedEventFromBlock } from "../../../adapters/outbound/desktop-contract/agent-session-block-event-adapter.ts";
import type {
  AgentRuntimeUsageDto,
  BackendEventEnvelope,
  BackendEventId,
  LiveTurnActivityDto,
  ProviderCliAgentId,
} from "../../../../shared/contracts/index.ts";

interface RuntimeStateBlockContext {
  blocksByThread: Map<string, AgentSessionBlock[]>;
  service: ThreadRuntimeService;
  onEvent?: (event: BackendEventEnvelope) => void;
  schedulePersist: (threadId: string) => void;
  nextEventId: () => BackendEventId;
}

export async function upsertUsageRuntimeStateBlock(
  input: RuntimeStateBlockContext & {
    threadId: string;
    agentId: ProviderCliAgentId;
    runtimeId: string;
    usage: AgentRuntimeUsageDto;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const blockId = `usage:${input.threadId}:${input.runtimeId}`;
  const existing = existingBlock(input.blocksByThread, input.threadId, blockId);
  await upsertRuntimeStateBlock(input, {
    blockId,
    threadId: input.threadId,
    agentId: input.agentId,
    kind: "usage",
    role: "runtime",
    sourceFrameIds: existing?.sourceFrameIds ?? [],
    localProvenance: {
      kind: "structured_usage",
      runtimeId: input.runtimeId,
    },
    status: "complete",
    title: "Usage",
    body: usageBlockBody(input.usage),
    data: {
      runtimeId: input.runtimeId,
      usage: input.usage,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export async function upsertActivityRuntimeStateBlock(
  input: RuntimeStateBlockContext & {
    threadId: string;
    agentId: ProviderCliAgentId;
    runtimeId: string;
    activity: LiveTurnActivityDto;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const blockId = `agent-activity:${input.threadId}:${input.runtimeId}`;
  const existing = existingBlock(input.blocksByThread, input.threadId, blockId);
  const empty = isEmptyActivity(input.activity);
  if (empty && existing === undefined) {
    return;
  }
  await upsertRuntimeStateBlock(input, {
    blockId,
    threadId: input.threadId,
    agentId: input.agentId,
    kind: "agent_activity",
    role: "runtime",
    sourceFrameIds: existing?.sourceFrameIds ?? [],
    localProvenance: {
      kind: "structured_activity",
      runtimeId: input.runtimeId,
    },
    status: empty ? "complete" : "streaming",
    title: "Activity",
    body: empty ? "Activity complete" : activityBlockBody(input.activity),
    data: {
      runtimeId: input.runtimeId,
      activity: input.activity,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

async function upsertRuntimeStateBlock(
  context: RuntimeStateBlockContext,
  block: AgentSessionBlock,
): Promise<void> {
  const blocks = new Map(
    (context.blocksByThread.get(block.threadId) ?? []).map((existing) => [
      existing.blockId,
      existing,
    ]),
  );
  blocks.set(block.blockId, block);
  context.onEvent?.(
    createAgentSessionBlockUpsertedEventFromBlock({
      eventId: context.nextEventId(),
      emittedAt: new Date().toISOString(),
      block,
    }),
  );
  await context.service.recordAgentSessionBlock({
    threadId: block.threadId,
    block,
  });
  context.blocksByThread.set(block.threadId, [...blocks.values()]);
  context.schedulePersist(block.threadId);
}

function existingBlock(
  blocksByThread: Map<string, AgentSessionBlock[]>,
  threadId: string,
  blockId: string,
): AgentSessionBlock | undefined {
  return blocksByThread.get(threadId)?.find((block) => block.blockId === blockId);
}

function usageBlockBody(usage: AgentRuntimeUsageDto): string {
  const parts: string[] = [];
  if (usage.totalTokens !== undefined) {
    parts.push(`${formatCompactNumber(usage.totalTokens)} tokens`);
  }
  if (usage.contextTokens !== undefined && usage.contextWindow !== undefined) {
    parts.push(
      `${formatCompactNumber(usage.contextTokens)} / ${formatCompactNumber(usage.contextWindow)} context`,
    );
  } else if (usage.contextTokens !== undefined) {
    parts.push(`${formatCompactNumber(usage.contextTokens)} context tokens`);
  }
  if (usage.contextUsedPercent !== undefined) {
    parts.push(`${usage.contextUsedPercent}% context`);
  }
  const rateLimitCount = usage.rateLimits?.length ?? 0;
  if (rateLimitCount > 0) {
    parts.push(`${rateLimitCount} quota ${rateLimitCount === 1 ? "window" : "windows"}`);
  }
  return parts.length === 0 ? "Usage updated" : `Usage updated: ${parts.join(" · ")}`;
}

function activityBlockBody(activity: LiveTurnActivityDto): string {
  const nestedAgents = activity.nestedAgents ?? 0;
  if (nestedAgents > 0) {
    const calls = activity.nestedToolCalls ?? 0;
    const agents = `${nestedAgents} ${nestedAgents === 1 ? "agent" : "agents"}`;
    return calls > 0
      ? `${agents} running · ${calls} tool ${calls === 1 ? "call" : "calls"}`
      : `${agents} running`;
  }
  const planTotal = activity.planTotal ?? 0;
  if (planTotal > 0) {
    const completed = activity.planCompleted ?? 0;
    return `${completed}/${planTotal} steps`;
  }
  return "Activity running";
}

function isEmptyActivity(activity: LiveTurnActivityDto): boolean {
  return (
    activity.nestedAgents === undefined &&
    activity.nestedToolCalls === undefined &&
    activity.planTotal === undefined &&
    activity.planCompleted === undefined
  );
}

function formatCompactNumber(value: number): string {
  if (value < 1000) {
    return String(value);
  }
  const thousands = value / 1000;
  if (thousands >= 100 || Number.isInteger(thousands)) {
    return `${Math.round(thousands)}k`;
  }
  return `${thousands.toFixed(1)}k`;
}
