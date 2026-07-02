import type {
  AgentSessionBlock,
  AgentSessionBlockUpdate,
} from "../../../application/domains/agent-session/agent-session-block.ts";
import type { ThreadRuntimeService } from "../../../application/services/thread/thread-runtime-service.ts";
import { createAgentSessionBlockCompletedEventFromUpdate, createAgentSessionBlockUpsertedEventFromBlock } from "../../../adapters/outbound/desktop-contract/agent-session-block-event-adapter.ts";
import type { BackendEventEnvelope } from "../../../../shared/contracts/index.ts";
import { nextEventId } from "./live-event-ids.ts";

export function emitBlockUpdate(input: {
  update: AgentSessionBlockUpdate;
  blocks: Map<string, AgentSessionBlock>;
  onEvent?: (event: BackendEventEnvelope) => void;
}): void {
  if (input.update.kind === "upsert") {
    input.blocks.set(input.update.block.blockId, input.update.block);
    input.onEvent?.(
      createAgentSessionBlockUpsertedEventFromBlock({
        eventId: nextEventId(),
        emittedAt: new Date().toISOString(),
        block: input.update.block,
      }),
    );
    return;
  }

  if (input.update.kind === "complete") {
    input.onEvent?.(
      createAgentSessionBlockCompletedEventFromUpdate({
        eventId: nextEventId(),
        emittedAt: new Date().toISOString(),
        update: input.update,
      }),
    );
  }
}

export async function recordBlockUpdateInService(
  service: ThreadRuntimeService,
  update: AgentSessionBlockUpdate,
): Promise<void> {
  if (update.kind === "upsert") {
    await service.recordAgentSessionBlock({
      threadId: update.block.threadId,
      block: update.block,
    });
  } else if (update.kind === "reset") {
    for (const block of update.blocks) {
      await service.recordAgentSessionBlock({ threadId: block.threadId, block });
    }
  }
}
