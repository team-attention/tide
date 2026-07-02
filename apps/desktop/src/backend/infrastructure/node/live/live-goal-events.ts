import type { ThreadGoalState, ThreadSnapshot } from "../../../application/domains/thread/thread.ts";
import type { ThreadRuntimeService } from "../../../application/services/thread/thread-runtime-service.ts";
import { toThreadSummaryDto } from "../../../adapters/inbound/contract-message-adapter/dto/thread-dtos.ts";
import { CONTRACT_VERSION, type BackendEventEnvelope } from "../../../../shared/contracts/index.ts";

export async function emitGoalState(input: {
  threadId: string;
  goalState: ThreadGoalState | undefined;
  service: ThreadRuntimeService;
  onEvent?: (event: BackendEventEnvelope) => void;
  nextEventId: () => string;
}): Promise<{ thread: ThreadSnapshot } | undefined> {
  const result = await input.service.recordProviderGoalState({
    threadId: input.threadId,
    goalState: input.goalState,
  });
  if (!result.ok) {
    return undefined;
  }
  input.onEvent?.({
    contractVersion: CONTRACT_VERSION,
    eventId: input.nextEventId(),
    kind: "thread.goalSet",
    emittedAt: new Date().toISOString(),
    payload: {
      thread: toThreadSummaryDto(result.thread),
    },
  });
  return { thread: result.thread };
}

export async function emitProviderTurnStarted(input: {
  threadId: string;
  service: ThreadRuntimeService;
  onEvent?: (event: BackendEventEnvelope) => void;
  nextEventId: () => string;
}): Promise<void> {
  const result = await input.service.recordProviderTurnStarted({
    threadId: input.threadId,
  });
  if (!result.ok) {
    return;
  }
  input.onEvent?.({
    contractVersion: CONTRACT_VERSION,
    eventId: input.nextEventId(),
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

export function goalKeepsRuntimeBusy(goalState: ThreadGoalState | undefined): boolean {
  return goalState?.status === "active";
}
