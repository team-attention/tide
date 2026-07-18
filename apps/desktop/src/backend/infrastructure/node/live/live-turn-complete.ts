import type { ThreadRuntimeService } from "../../../application/services/thread/thread-runtime-service.ts";
import type { BackendEventEnvelope } from "../../../../shared/contracts/index.ts";
import { CONTRACT_VERSION } from "../../../../shared/contracts/index.ts";
import { toAgentSessionBlockDto } from "../../../adapters/inbound/contract-message-adapter/dto/thread-dtos.ts";
import { nextEventId } from "./live-event-ids.ts";

export async function emitTurnComplete(input: {
  threadId: string;
  service: ThreadRuntimeService;
  onEvent?: (event: BackendEventEnvelope) => void;
  force?: boolean;
}): Promise<void> {
  const result = await input.service.recordTurnComplete({ threadId: input.threadId, force: input.force });
  if (!result.ok) return;
  if (result.submittedBlock !== undefined) {
    input.onEvent?.({
      contractVersion: CONTRACT_VERSION,
      eventId: nextEventId(),
      kind: "agentSessionBlock.upserted",
      emittedAt: new Date().toISOString(),
      payload: { block: toAgentSessionBlockDto(result.thread, result.submittedBlock) },
    });
  }
  input.onEvent?.({
    contractVersion: CONTRACT_VERSION,
    eventId: nextEventId(),
    kind: "agentRuntime.stateChanged",
    emittedAt: new Date().toISOString(),
    payload: {
      threadId: result.thread.threadId,
      state: result.runtimeState,
      changedAt: result.thread.updatedAt,
      queuedInputs: result.thread.queuedInputs,
    },
  });
}
