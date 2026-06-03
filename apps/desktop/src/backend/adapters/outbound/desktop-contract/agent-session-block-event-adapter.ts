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
  const dto: AgentSessionBlockDto = {
    blockId: block.blockId,
    threadId: block.threadId,
    kind: block.kind,
    status: block.status,
    updatedAt: block.updatedAt,
  };
  if (block.agentId !== undefined) {
    dto.agentId = block.agentId;
  }
  if (block.role !== undefined) {
    dto.role = block.role;
  }
  if (block.sourceFrameIds.length > 0) {
    dto.sourceFrameIds = [...block.sourceFrameIds];
  }
  if (localProvenance !== undefined) {
    dto.localProvenance = localProvenance;
  }
  if (block.title !== undefined) {
    dto.title = block.title;
  }
  if (block.body !== undefined) {
    dto.body = block.body;
  }
  if (data !== undefined) {
    dto.data = data;
  }
  if (block.rawFallback !== undefined) {
    dto.rawFallback = block.rawFallback;
  }
  if (block.createdAt !== undefined) {
    dto.createdAt = block.createdAt;
  }
  return dto;
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
