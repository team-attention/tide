import type { AgentSessionBlock } from "../../../application/domains/agent-session/agent-session-block.ts";
import type { NativeRuntimeEvent, NativeTransport } from "../../../application/domains/native-agent/native-runtime-event.ts";
import type { SemanticAgentBlock } from "../../../application/domains/native-agent/semantic-agent-block.ts";
import {
  isSemanticAgentSessionProvider,
  semanticAgentBlockToAgentSessionBlock,
} from "../../../application/domains/native-agent/semantic-agent-block.ts";
import type { ThreadRuntimeService } from "../../../application/services/thread/thread-runtime-service.ts";
import type { StructuredProviderEvent } from "../../../adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
import {
  createInMemoryNativeEvidenceStore,
  type NativeEvidenceStore,
} from "../../../adapters/outbound/agent-runtime/evidence/native-evidence-store.ts";
import { createNativeRuntimePipeline } from "../../../adapters/outbound/agent-runtime/projectors/native-runtime-pipeline.ts";
import { structuredToNativeRuntimeEvent } from "../../../adapters/outbound/agent-runtime/clients/structured-to-native-runtime-event.ts";
import type { BackendEventEnvelope, ProviderCliAgentId } from "../../../../shared/contracts/index.ts";
import { emitBlockUpdate, recordBlockUpdateInService } from "./live-block-updates.ts";
import { nextEventId } from "./live-event-ids.ts";

export const nativeVisibleSemanticBlockKinds: ReadonlySet<SemanticAgentBlock["kind"]> = new Set([
  "message",
  "reasoning",
  "plan",
  "command_run",
  "file_change",
  "tool_call",
  "mcp_call",
  "approval_prompt",
  "question_prompt",
  "usage",
  "agent_activity",
  "notice",
]);

export function createLiveNativeRuntimeProjector(input: {
  blocksByThread: Map<string, AgentSessionBlock[]>;
  service: () => ThreadRuntimeService;
  onEvent?: (event: BackendEventEnvelope) => void;
  schedulePersist: (threadId: string) => void;
  evidenceStore?: NativeEvidenceStore;
}) {
  const nativePipeline = createNativeRuntimePipeline({
    evidenceStore: input.evidenceStore ?? createInMemoryNativeEvidenceStore({
      keepRawFrames: process.env.TIDE_NATIVE_RAW_EVIDENCE === "1",
    }),
  });
  const nativeSequenceByRuntime = new Map<string, number>();

  return {
    ingestStructuredMirror(eventInput: {
      threadId: string;
      agentId: ProviderCliAgentId;
      runtimeId: string;
      event: StructuredProviderEvent;
    }): SemanticAgentBlock[] {
      const prior = nativeSequenceByRuntime.get(eventInput.runtimeId) ?? 0;
      const nativeSequence = prior + 1;
      nativeSequenceByRuntime.set(eventInput.runtimeId, nativeSequence);
      const state = nativePipeline.stateForRuntime(eventInput.runtimeId);
      return nativePipeline.ingest(structuredToNativeRuntimeEvent({
        eventId: nextEventId(),
        provider: eventInput.agentId,
        transport: transportForAgent(eventInput.agentId),
        runtimeId: eventInput.runtimeId,
        tideThreadId: eventInput.threadId,
        providerSessionId: state?.providerSessionId,
        nativeSequence,
        receivedAt: new Date().toISOString(),
        event: eventInput.event,
      }));
    },
    ingestNativeEvent(event: NativeRuntimeEvent): SemanticAgentBlock[] {
      return nativePipeline.ingest(event);
    },
    async recordProjectedRuntimeStateBlocks(
      threadId: string,
      semanticBlocks: SemanticAgentBlock[],
      allowedKinds: ReadonlySet<SemanticAgentBlock["kind"]>,
    ): Promise<void> {
      for (const semanticBlock of semanticBlocks) {
        if (!allowedKinds.has(semanticBlock.kind) || !isSemanticAgentSessionProvider(semanticBlock.provider)) {
          continue;
        }
        const existing = input.blocksByThread
          .get(threadId)
          ?.find((block) => block.blockId === semanticBlock.blockId);
        if (
          semanticBlock.kind === "agent_activity" &&
          semanticBlock.status === "completed" &&
          existing === undefined &&
          isEmptyNativeActivityBlock(semanticBlock)
        ) {
          continue;
        }
        const block = semanticAgentBlockToAgentSessionBlock({
          ...semanticBlock,
          provider: semanticBlock.provider,
        });
        const blocks = new Map(
          (input.blocksByThread.get(threadId) ?? []).map((existingBlock) => [
            existingBlock.blockId,
            existingBlock,
          ]),
        );
        emitBlockUpdate({ update: { kind: "upsert", block }, blocks, onEvent: input.onEvent });
        if (block.status === "streaming" && (block.kind === "agent_message" || block.kind === "reasoning")) {
          await input.service().recordStreamingBlock({ threadId, block });
          input.blocksByThread.set(threadId, [...blocks.values()]);
          continue;
        }
        await recordBlockUpdateInService(input.service(), { kind: "upsert", block });
        input.blocksByThread.set(threadId, [...blocks.values()]);
        input.schedulePersist(threadId);
      }
    },
  };
}

function transportForAgent(agentId: ProviderCliAgentId): NativeTransport {
  switch (agentId) {
    case "codex":
      return "codex_app_server";
    case "claude":
      return "claude_stream_json";
    case "opencode":
      return "acp";
  }
}

function isEmptyNativeActivityBlock(block: SemanticAgentBlock): boolean {
  const activity = block.data.activity;
  if (activity === undefined || activity === null || typeof activity !== "object") {
    return true;
  }
  return Object.keys(activity).length === 0;
}
