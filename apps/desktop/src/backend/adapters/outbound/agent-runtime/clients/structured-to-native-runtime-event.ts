import type { ProviderCliAgentId, ThreadId } from "../../../../application/domains/thread/thread.ts";
import type {
  NativeProviderId,
  NativeRuntimeEvent,
  NativeRuntimeIds,
  NativeTransport,
} from "../../../../application/domains/native-agent/native-runtime-event.ts";
import type { StructuredProviderEvent } from "../structured/structured-runtime-events.ts";

export interface StructuredToNativeRuntimeEventInput {
  eventId: string;
  provider: ProviderCliAgentId;
  transport: NativeTransport;
  runtimeId: string;
  tideThreadId: ThreadId;
  providerSessionId?: string;
  nativeSequence: number;
  receivedAt: string;
  event: StructuredProviderEvent;
}

export function structuredToNativeRuntimeEvent(
  input: StructuredToNativeRuntimeEventInput,
): NativeRuntimeEvent {
  return {
    eventId: input.eventId,
    provider: input.provider as NativeProviderId,
    transport: input.transport,
    runtimeId: input.runtimeId,
    tideThreadId: input.tideThreadId,
    providerSessionId: input.providerSessionId,
    nativeSequence: input.nativeSequence,
    receivedAt: input.receivedAt,
    nativeKind: input.event.kind,
    nativeIds: nativeIdsFromStructuredProviderEvent(input.event),
    payload: input.event,
    redaction: "reduced",
  };
}

export function nativeIdsFromStructuredProviderEvent(
  event: StructuredProviderEvent,
): NativeRuntimeIds {
  switch (event.kind) {
    case "provider_capabilities":
      return {};
    case "session_ref":
      return { sessionId: event.ref.value };
    case "content_record":
      return idsFromContentRecord(event.sourceRef, event.payload);
    case "content_delta":
      return { blockId: event.blockId };
    case "prompt":
      return {
        ...nativeIdsFromPromptState(event.promptState.nativeIds),
        requestId: event.promptState.promptId,
      };
    case "prompt_withdrawn":
      return { requestId: event.promptId };
    case "delivery_acknowledged":
      return {
        deliveryId: event.deliveryId,
        messageId: event.providerMessageId,
        turnId: event.providerTurnId,
      };
    case "turn_started":
      return { deliveryId: event.deliveryId, turnId: event.turnId };
    case "turn_completed":
      return { deliveryId: event.deliveryId, turnId: event.turnId };
    case "goal_updated":
    case "goal_cleared":
      return {};
    case "commands":
    case "model_catalog":
    case "usage":
    case "live_activity":
    case "runtime_notice":
      return {};
    case "runtime_exited":
      return { deliveryId: event.activeDeliveryId };
  }
}

function nativeIdsFromPromptState(value: Record<string, string> | undefined): NativeRuntimeIds {
  if (value === undefined) {
    return {};
  }
  const ids: NativeRuntimeIds = {};
  setNativeId(ids, "threadId", stringField(value, "threadId"));
  setNativeId(ids, "turnId", stringField(value, "turnId"));
  setNativeId(ids, "itemId", stringField(value, "itemId"));
  setNativeId(ids, "requestId", stringField(value, "requestId"));
  setNativeId(ids, "callId", stringField(value, "callId"));
  setNativeId(ids, "messageId", stringField(value, "messageId"));
  setNativeId(ids, "blockId", stringField(value, "blockId"));
  setNativeId(ids, "sessionId", stringField(value, "sessionId"));
  setNativeId(ids, "activityId", stringField(value, "activityId"));
  return ids;
}

function setNativeId(ids: NativeRuntimeIds, key: keyof NativeRuntimeIds, value: string | undefined): void {
  if (value !== undefined) {
    ids[key] = value;
  }
}

function idsFromContentRecord(
  sourceRef: string,
  payload: Record<string, unknown>,
): NativeRuntimeIds {
  const blockId = stringField(payload, "blockId") ?? sourceRef;
  const callId = stringField(payload, "callId");
  const requestId = stringField(payload, "requestId");
  const messageId = stringField(payload, "messageId");
  return {
    blockId,
    callId,
    requestId,
    messageId,
  };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
