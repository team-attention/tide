import type {
  AgentSessionBlock,
  AgentSessionBlockUpdate,
} from "../../../application/domains/agent-session/agent-session-block.ts";
import {
  createAgentSessionBlockCompletedEvent,
  createAgentSessionBlockUpsertedEvent,
  isJsonObject,
  sanitizeJsonValue,
  type AgentSessionBlockDto,
  type BackendEventEnvelope,
  type BackendEventId,
  type JsonObject,
  type RequestId,
} from "../../../../shared/contracts/index.ts";

export function toAgentSessionBlockDto(
  block: AgentSessionBlock,
): AgentSessionBlockDto {
  const data = toJsonObject(block.data);
  const localProvenance = toJsonObject(block.localProvenance);

  return {
    blockId: block.blockId,
    threadId: block.threadId,
    agentId: block.agentId,
    kind: block.kind,
    role: block.role,
    sourceFrameIds: [...block.sourceFrameIds],
    localProvenance,
    status: block.status,
    title: block.title,
    body: block.body,
    data,
    rawFallback: block.rawFallback,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  };
}

export function createAgentSessionBlockUpsertedEventFromBlock(options: {
  eventId: BackendEventId;
  requestId?: RequestId;
  emittedAt: string;
  block: AgentSessionBlock;
}): BackendEventEnvelope<"agentSessionBlock.upserted"> {
  return createAgentSessionBlockUpsertedEvent({
    eventId: options.eventId,
    requestId: options.requestId,
    emittedAt: options.emittedAt,
    block: toAgentSessionBlockDto(options.block),
  });
}

export function createAgentSessionBlockCompletedEventFromUpdate(options: {
  eventId: BackendEventId;
  requestId?: RequestId;
  emittedAt: string;
  update: Extract<AgentSessionBlockUpdate, { kind: "complete" }>;
}): BackendEventEnvelope<"agentSessionBlock.completed"> {
  return createAgentSessionBlockCompletedEvent({
    eventId: options.eventId,
    requestId: options.requestId,
    emittedAt: options.emittedAt,
    blockId: options.update.blockId,
    threadId: options.update.threadId,
    status: options.update.status,
    completedAt: options.update.updatedAt,
  });
}

function toJsonObject(value: Record<string, unknown> | undefined): JsonObject | undefined {
  if (value === undefined) {
    return undefined;
  }
  const sanitized = sanitizeJsonValue(value);
  return isJsonObject(sanitized) ? sanitized : undefined;
}
