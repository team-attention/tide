import type { ThreadRuntimeService } from "../../../application/services/thread/thread-runtime-service.ts";
import type { StructuredProviderEvent } from "../../../adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
import type { BackendEventEnvelope } from "../../../../shared/contracts/index.ts";
import { CONTRACT_VERSION } from "../../../../shared/contracts/index.ts";
import { toAgentSessionBlockDto } from "../../../adapters/inbound/contract-message-adapter/dto/thread-dtos.ts";
import { nextEventId } from "./live-event-ids.ts";

export async function projectDeliveryAcknowledged(input: {
  threadId: string;
  event: Extract<StructuredProviderEvent, { kind: "delivery_acknowledged" }>;
  service: ThreadRuntimeService;
  onEvent?: (event: BackendEventEnvelope) => void;
}): Promise<void> {
  const result = await input.service.recordDeliveryState({
    threadId: input.threadId,
    deliveryId: input.event.deliveryId,
    state: "acknowledged",
    providerMessageId: input.event.providerMessageId,
    providerTurnId: input.event.providerTurnId,
  });
  if (!result.ok || result.block === undefined) return;
  input.onEvent?.({
    contractVersion: CONTRACT_VERSION,
    eventId: nextEventId(),
    kind: "agentSessionBlock.upserted",
    emittedAt: new Date().toISOString(),
    payload: { block: toAgentSessionBlockDto(result.thread, result.block) },
  });
}

export async function recordDeliveryTerminal(input: {
  threadId: string;
  event: Extract<StructuredProviderEvent, { kind: "turn_completed" }>;
  service: ThreadRuntimeService;
}): Promise<void> {
  if (input.event.deliveryId === undefined) return;
  const state = input.event.status === "completed"
    ? "completed"
    : input.event.status === "interrupted" || input.event.status === "cancelled"
      ? "interrupted"
      : input.event.status === "unknown"
        ? "indeterminate"
        : "failed";
  await input.service.recordDeliveryState({
    threadId: input.threadId,
    deliveryId: input.event.deliveryId,
    state,
    providerTurnId: input.event.turnId,
    nativeStatus: input.event.nativeStatus,
  });
}

export async function recordExitedDeliveryIndeterminate(input: {
  threadId: string;
  event: Extract<StructuredProviderEvent, { kind: "runtime_exited" }>;
  service: ThreadRuntimeService;
}): Promise<void> {
  if (input.event.activeDeliveryId === undefined) return;
  await input.service.recordDeliveryState({
    threadId: input.threadId,
    deliveryId: input.event.activeDeliveryId,
    state: "indeterminate",
    nativeStatus: "runtime_exited_without_terminal",
  });
}
