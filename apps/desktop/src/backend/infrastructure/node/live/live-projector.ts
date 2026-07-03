import type { ThreadPersistenceService } from "../../../application/services/thread/thread-persistence-service.ts";
import type { AgentIntegrationRegistry } from "../../../adapters/outbound/agent-runtime/runtime-ports/agent-integration-agent-runtime-port.ts";
import { createFixtureAgentSessionReader } from "../../../application/services/thread/fixture-agent-session-reader.ts";
import type { AgentSessionBlock } from "../../../application/domains/agent-session/agent-session-block.ts";
import type { AgentTurnOutcome } from "../../../application/ports/outbound/agent-integration-port.ts";
import type { NativeRuntimeEvent } from "../../../application/domains/native-agent/native-runtime-event.ts";
import type { RawAgentFrame } from "../../../application/services/thread/thread-runtime-service.ts";
import type { StructuredProviderEvent } from "../../../adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
import type { NativeEvidenceStore } from "../../../adapters/outbound/agent-runtime/evidence/native-evidence-store.ts";
import type { PromptState } from "../../../application/domains/thread/thread.ts";
import type { DiscoveredProviderSessionRef } from "../provider/provider-session-ref.ts";
import type { ThreadRuntimeService } from "../../../application/services/thread/thread-runtime-service.ts";
import { CONTRACT_VERSION } from "../../../../shared/contracts/index.ts";
import type { BackendEventEnvelope, ProviderCliAgentId } from "../../../../shared/contracts/index.ts";
import { toAgentSessionBlockDto } from "../../../adapters/inbound/contract-message-adapter/dto/thread-dtos.ts";
import { planActivityFromToolResultPayload } from "../../../adapters/outbound/agent-runtime/structured/plan-activity.ts";
import { emitStructuredActivity, emitStructuredUsage } from "./live-usage-events.ts";
import { emitGoalState, emitProviderTurnStarted, goalKeepsRuntimeBusy } from "./live-goal-events.ts";
import { persistThreadBlocks } from "./live-session-cache-persistence.ts";
import { emitBlockUpdate, recordBlockUpdateInService } from "./live-block-updates.ts";
import { nextEventId } from "./live-event-ids.ts";
import {
  providerCapabilityCatalogFromProviderCapabilities,
  providerCapabilityCatalogFromRuntimeCommands,
} from "../../../adapters/outbound/agent-integrations/provider-capability-catalog.ts";
import { localProviderCapabilities } from "./live-local-provider-capabilities.ts";
import { upsertActivityRuntimeStateBlock } from "./live-runtime-state-blocks.ts";
import {
  createLiveNativeRuntimeProjector,
  nativeVisibleSemanticBlockKinds,
} from "./live-native-runtime-projector.ts";
import { createLiveProviderCapabilityEmitter } from "./live-provider-capabilities.ts";

export function createLiveAgentSessionEventProjector(input: {
  service: () => ThreadRuntimeService;
  persistence: ThreadPersistenceService;
  onEvent?: (event: BackendEventEnvelope) => void;
  homeDir: string;
  integrations: AgentIntegrationRegistry;
  nativeProjectionMode?: "structured_mirror" | "external_all_blocks";
  nativeEvidenceStore?: NativeEvidenceStore;
}) {
  const reader = createFixtureAgentSessionReader();
  const blocksByThread = new Map<string, AgentSessionBlock[]>();

    // Coalesce conversation-cache persistence: streaming turns update memory,
    // then write blocks on a trailing debounce with hard boundary flushes.
  const PERSIST_DEBOUNCE_MS = 300;
  const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const persistInFlight = new Map<string, Promise<void>>();
  let persistWriteCount = 0;

  const runPersist = async (threadId: string): Promise<void> => {
    // Serialize per thread so two atomic writes never race on the same tmp file.
    const prior = persistInFlight.get(threadId) ?? Promise.resolve();
    const next = prior
      .catch(() => {})
      .then(async () => {
        if (process.env.TIDE_DEBUG_PERSIST === "1") {
          persistWriteCount += 1;
          process.stdout.write(
            `[tide-persist] write #${persistWriteCount} thread=${threadId}\n`,
          );
        }
        await persistThreadBlocks({
          persistence: input.persistence,
          service: input.service(),
          threadId,
        });
      });
    persistInFlight.set(threadId, next);
    await next;
    if (persistInFlight.get(threadId) === next) {
      persistInFlight.delete(threadId);
    }
  };

  const schedulePersist = (threadId: string): void => {
    const existing = persistTimers.get(threadId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      persistTimers.delete(threadId);
      void runPersist(threadId);
    }, PERSIST_DEBOUNCE_MS);
    // Never keep the event loop alive solely for a pending best-effort cache write.
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    persistTimers.set(threadId, timer);
  };
  const nativeRuntimeProjector = createLiveNativeRuntimeProjector({
    blocksByThread,
    service: input.service,
    onEvent: input.onEvent,
    schedulePersist,
    evidenceStore: input.nativeEvidenceStore,
  });
  const capabilityEmitter = createLiveProviderCapabilityEmitter({
    onEvent: input.onEvent,
    nextEventId,
  });

  const flushPersist = async (threadId: string): Promise<void> => {
    const timer = persistTimers.get(threadId);
    if (timer !== undefined) {
      clearTimeout(timer);
      persistTimers.delete(threadId);
    }
    await runPersist(threadId);
  };

  const flushAllPersists = async (): Promise<void> => {
    const ids = new Set<string>([...persistTimers.keys(), ...persistInFlight.keys()]);
    await Promise.all([...ids].map((id) => flushPersist(id)));
  };

  // Serialize event ingestion PER THREAD. Both ingest paths mutate shared
  // in-memory thread state (blocksByThread, promptState, runtimeState, the active
  // runtime handle) across awaits; without ordering, events that arrive close
  // together (streaming deltas, a tool_use, a permission prompt, turn-state
  // changes) interleave at their await points and race — a permission prompt can
  // be clobbered or silently dropped, leaving the agent blocked on a can_use_tool
  // with no approval card (the intermittent "is it running or done?" wedge).
  // Chaining per threadId (same idiom as persistInFlight) runs each event to
  // completion in arrival order; different threads still run concurrently. The
  // try/finally guarantees the map entry is cleared even if a handler throws.
  const ingestInFlight = new Map<string, Promise<unknown>>();
  const serializeIngest = (threadId: string, run: () => Promise<unknown>): Promise<void> => {
    const prior = ingestInFlight.get(threadId) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(run);
    ingestInFlight.set(threadId, next);
    return (async () => {
      try {
        await next;
      } finally {
        if (ingestInFlight.get(threadId) === next) {
          ingestInFlight.delete(threadId);
        }
      }
    })();
  };

  // Uniform turn settle. Every Agent Integration produces an AgentTurnOutcome from
  // its OWN signals (claude/codex hook payload, codex rollout
  // transcript); this shared path applies it identically. Provider-specific
  // signal collection lives in the adapters. `finalMessage` becomes the agent
  // answer block; `notice` (rate limit / out of credits / empty / error) becomes a
  // visible `error` block so the turn never settles silently empty. Both go through
  // the same reader pipeline as streamed content and are deduped by body, so they
  // never duplicate what the transcript already produced. Then the turn settles.
  const ingestTurnOutcomeAndSettle = async (args: {
    outcome: AgentTurnOutcome;
    threadId: string;
    agentId: ProviderCliAgentId;
    runtimeId: string;
    sessionId?: string;
    nextBlocks: Map<string, AgentSessionBlock>;
  }): Promise<void> => {
    const service = input.service();
    const ingest = async (
      kind: "message" | "notice",
      rawBody: string,
    ): Promise<void> => {
      const body = rawBody.trim();
      if (body.length === 0) {
        return;
      }
      let hash = 5381;
      for (let i = 0; i < body.length; i += 1) {
        hash = ((hash << 5) + hash + body.charCodeAt(i)) | 0;
      }
      const sessionId = args.sessionId ?? args.runtimeId;
      const blockId = `provider:${args.threadId}:${sessionId}:${kind}:${(hash >>> 0).toString(36)}`;
      const hydrated = service.peekThread(args.threadId);
      if (!hydrated.ok) {
        return;
      }
      const payload =
        kind === "message"
          ? {
              type: "message",
              role: "agent",
              status: "complete",
              blockId,
              body,
              sourceRuntimeId: args.runtimeId,
            }
          : {
              type: "notice",
              status: "failed",
              blockId,
              body,
              sourceRuntimeId: args.runtimeId,
            };
      const frame = await service.appendRawAgentFrame({
        threadId: args.threadId,
        agentId: args.agentId,
        source: "provider_history",
        sourceRef: blockId,
        payloadKind: "provider_record",
        payload,
        body,
      });
      const result = reader.read({
        thread: hydrated.thread,
        agentBinding: hydrated.thread.agentBinding,
        frames: [frame],
        existingBlocks: [...args.nextBlocks.values()],
      });
      for (const update of result.blockUpdates) {
        await recordBlockUpdateInService(service, update);
        emitBlockUpdate({ update, blocks: args.nextBlocks, onEvent: input.onEvent });
      }
      schedulePersist(args.threadId);
    };

    // finalMessage is content ONLY for one-shot agents whose single session read has
    // no competing streaming reader. claude/codex return no finalMessage from
    // turn-end (their readers own the answer), so nothing is double-produced. The
    // body-hashed blockId makes repeated polls idempotent.
    if (args.outcome.finalMessage !== undefined) {
      await ingest("message", args.outcome.finalMessage);
    }
    if (args.outcome.notice !== undefined) {
      await ingest("notice", args.outcome.notice.message);
    }
    await emitTurnComplete({
      threadId: args.threadId,
      service,
      onEvent: input.onEvent,
      // A turn-end NEVER force-settles past a live, unanswered prompt — not even one that
      // carried a final message. The AskUserQuestion pattern produces BOTH a final
      // message (the agent's explanatory text) AND a question card in the same turn; the
      // old `finalMessage !== undefined` force dropped that just-raised card (root of the
      // "card never showed / thread stuck waiting" report). When there is NO live prompt,
      // recordTurnComplete settles regardless of force, so force adds nothing there; when
      // there IS one, the card must survive so the user can answer it (or Stop). Only a
      // genuine runtime_exited forces (handled below) — that card is truly dead. A card
      // the user already answered is settled via promptAnsweredPendingSettle, not force.
    });
    // Turn settled — the conversation's durable state matters now; flush eagerly.
    await flushPersist(args.threadId);
  };

  const appendFrameAndEmit = async (frameInput: {
    threadId: string;
    agentId: RawAgentFrame["agentId"];
    source: RawAgentFrame["source"];
    sourceRef?: string;
    payloadKind?: RawAgentFrame["payloadKind"];
    payload?: unknown;
    body?: string;
  }): Promise<void> => {
    const service = input.service();
    const frame = await service.appendRawAgentFrame({
      threadId: frameInput.threadId,
      agentId: frameInput.agentId,
      source: frameInput.source,
      sourceRef: frameInput.sourceRef,
      payloadKind: frameInput.payloadKind,
      payload: frameInput.payload,
      body: frameInput.body,
    });
    const hydrated = service.peekThread(frameInput.threadId);
    if (!hydrated.ok) {
      return;
    }

    const existingBlocks = blocksByThread.get(frameInput.threadId) ?? [];
    const readResult = reader.read({
      thread: hydrated.thread,
      agentBinding: hydrated.thread.agentBinding,
      frames: [frame],
      existingBlocks,
    });

    const nextBlocks = new Map(existingBlocks.map((block) => [block.blockId, block]));
    for (const update of readResult.blockUpdates) {
      emitBlockUpdate({
        update,
        blocks: nextBlocks,
        onEvent: input.onEvent,
      });
      await recordBlockUpdateInService(service, update);
    }
    blocksByThread.set(frameInput.threadId, [...nextBlocks.values()]);
    schedulePersist(frameInput.threadId);
    await emitPromptState({
      promptState: readResult.promptState,
      service,
      onEvent: input.onEvent,
    });
  };

  return {
    async ingestNativeRuntimeEvent(eventInput: {
      threadId: string;
      agentId: ProviderCliAgentId;
      runtimeId: string;
      event: NativeRuntimeEvent;
    }): Promise<void> {
      return serializeIngest(eventInput.threadId, async () => {
        const blocks = nativeRuntimeProjector.ingestNativeEvent(eventInput.event);
        await nativeRuntimeProjector.recordProjectedRuntimeStateBlocks(
          eventInput.threadId,
          blocks,
          nativeVisibleSemanticBlockKinds,
        );
      });
    },
    async ingestStructuredProviderEvent(eventInput: {
      threadId: string;
      agentId: ProviderCliAgentId;
      runtimeId: string;
      event: StructuredProviderEvent;
    }): Promise<void> {
      return serializeIngest(eventInput.threadId, async () => {
      const service = input.service();
      const event = eventInput.event;
      const nativeBlocks =
        input.nativeProjectionMode === "external_all_blocks"
          ? []
          : nativeRuntimeProjector.ingestStructuredMirror(eventInput);
      if (event.kind === "session_ref") {
        await recordDiscoveredProviderSessionRef({
          service,
          persistence: input.persistence,
          threadId: eventInput.threadId,
          providerSessionRef: event.ref,
        });
        return;
      }
      if (event.kind === "provider_capabilities") {
        capabilityEmitter.emitCapabilitiesChanged(
          eventInput.threadId,
          eventInput.agentId,
          [
            ...providerCapabilityCatalogFromProviderCapabilities(eventInput.agentId, event),
            ...localProviderCapabilities(eventInput.agentId, input.homeDir),
          ],
        );
        await nativeRuntimeProjector.recordProjectedRuntimeStateBlocks(eventInput.threadId, nativeBlocks, new Set(["config_state"]));
        return;
      }
      if (event.kind === "turn_started") {
        await emitProviderTurnStarted({
          threadId: eventInput.threadId,
          service,
          onEvent: input.onEvent,
          nextEventId,
        });
        return;
      }
      if (event.kind === "goal_updated") {
        const result = await emitGoalState({
          threadId: eventInput.threadId,
          goalState: {
            ...event.goal,
            updatedAt: event.goal.updatedAt ?? new Date().toISOString(),
          },
          service,
          onEvent: input.onEvent,
          nextEventId,
        });
        if (result !== undefined && !goalKeepsRuntimeBusy(result.thread.goalState)) {
          await emitTurnComplete({
            threadId: eventInput.threadId,
            service,
            onEvent: input.onEvent,
            force: true,
          });
        }
        return;
      }
      if (event.kind === "goal_cleared") {
        await emitGoalState({
          threadId: eventInput.threadId,
          goalState: undefined,
          service,
          onEvent: input.onEvent,
          nextEventId,
        });
        return;
      }
      if (event.kind === "content_record") {
        const activity = planActivityFromToolResultPayload(event.payload);
        if (activity !== undefined) {
          emitStructuredActivity({
            threadId: eventInput.threadId,
            activity,
            nextEventId,
            onEvent: input.onEvent,
          });
          await upsertActivityRuntimeStateBlock({
            blocksByThread,
            service,
            nextEventId,
            onEvent: input.onEvent,
            schedulePersist,
            threadId: eventInput.threadId,
            agentId: eventInput.agentId,
            runtimeId: eventInput.runtimeId,
            activity,
          });
        }
        if (input.nativeProjectionMode !== "external_all_blocks") {
          await appendFrameAndEmit({
            threadId: eventInput.threadId,
            agentId: eventInput.agentId,
            source: "provider_history",
            sourceRef: event.sourceRef,
            payloadKind: "provider_record",
            payload: event.payload,
            body: event.body,
          });
        }
        return;
      }
      if (event.kind === "content_delta") {
        if (input.nativeProjectionMode === "external_all_blocks") {
          return;
        }
        // Legacy streaming path: UI-only upsert; final content_record persists.
        const now = new Date().toISOString();
        const blocks = new Map(
          (blocksByThread.get(eventInput.threadId) ?? []).map((b) => [b.blockId, b]),
        );
        const existing = blocks.get(event.blockId);
        const block: AgentSessionBlock = {
          blockId: event.blockId,
          threadId: eventInput.threadId,
          agentId: eventInput.agentId,
          kind: event.blockKind,
          role: event.role,
          sourceFrameIds: existing?.sourceFrameIds ?? [],
          status: "streaming",
          body: event.body,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        emitBlockUpdate({ update: { kind: "upsert", block }, blocks, onEvent: input.onEvent });
        blocksByThread.set(eventInput.threadId, [...blocks.values()]);
        // Mirror the in-flight block into the service's in-memory streaming tail (NOT
        // cachedBlocks, NOT persistence) so a re-hydrate mid-turn still surfaces it. The
        // matching content_record finalizes the same blockId into cachedBlocks and evicts
        // it here. See docs_v2/specs/hydrate-live-streaming-tail.md.
        await service.recordStreamingBlock({ threadId: eventInput.threadId, block });
        return;
      }
      if (event.kind === "prompt") {
        await emitPromptState({
          promptState: event.promptState,
          service,
          onEvent: input.onEvent,
        });
        // A prompt pauses the turn waiting on the user; make the conversation up
        // to this point durable so a restart shows it (the stale prompt itself is
        // reconciled away on reopen).
        await flushPersist(eventInput.threadId);
        return;
      }
      if (event.kind === "commands") {
        capabilityEmitter.emitCapabilitiesChanged(
          eventInput.threadId,
          eventInput.agentId,
          [
            ...providerCapabilityCatalogFromRuntimeCommands(eventInput.agentId, event.commands),
            ...localProviderCapabilities(eventInput.agentId, input.homeDir),
          ],
        );
        input.onEvent?.({
          contractVersion: CONTRACT_VERSION,
          eventId: nextEventId(),
          kind: "agentRuntime.commandsChanged",
          emittedAt: new Date().toISOString(),
          payload: {
            threadId: eventInput.threadId,
            agentId: eventInput.agentId,
            commands: event.commands,
          },
        });
        return;
      }
      if (event.kind === "model_catalog") {
        input.onEvent?.({
          contractVersion: CONTRACT_VERSION,
          eventId: nextEventId(),
          kind: "agentRuntime.modelCatalogChanged",
          emittedAt: new Date().toISOString(),
          payload: {
            threadId: eventInput.threadId,
            agentId: eventInput.agentId,
            models: event.models,
            currentModel: event.currentModel,
          },
        });
        return;
      }
      if (event.kind === "runtime_notice") {
        input.onEvent?.({
          contractVersion: CONTRACT_VERSION,
          eventId: nextEventId(),
          kind: "agentRuntime.noticePosted",
          emittedAt: new Date().toISOString(),
          payload: {
            threadId: eventInput.threadId,
            agentId: eventInput.agentId,
            level: event.level,
            message: event.message,
          },
        });
        return;
      }
      if (event.kind === "usage") {
        const usage = emitStructuredUsage({
          threadId: eventInput.threadId,
          agentId: eventInput.agentId,
          usage: event.usage,
          nextEventId,
          onEvent: input.onEvent,
        });
        if (usage !== undefined) {
          await nativeRuntimeProjector.recordProjectedRuntimeStateBlocks(
            eventInput.threadId,
            nativeBlocks,
            new Set(["usage"]),
          );
        }
        return;
      }
      if (event.kind === "live_activity") {
        const { nestedAgents, nestedToolCalls, planTotal, planCompleted } = event;
        const activity = { nestedAgents, nestedToolCalls, planTotal, planCompleted };
        emitStructuredActivity({
          threadId: eventInput.threadId,
          activity,
          nextEventId,
          onEvent: input.onEvent,
        });
        await nativeRuntimeProjector.recordProjectedRuntimeStateBlocks(
          eventInput.threadId,
          nativeBlocks,
          new Set(["agent_activity"]),
        );
        return;
      }
      if (event.kind === "prompt_withdrawn") {
        // The provider RETRACTED a pending interaction (e.g. a question + its cancel in
        // one chunk). Clear that exact prompt NOW — deterministically, not by waiting for
        // a turn-end that may never come (which left a ghost card). The service promotes
        // the next queued prompt or resumes running; we surface the resulting state.
        await emitPromptWithdrawal({
          threadId: eventInput.threadId,
          promptId: event.promptId,
          service,
          onEvent: input.onEvent,
        });
        return;
      }
      if (event.kind === "turn_completed") {
        if (event.usage !== undefined) {
          const usage = emitStructuredUsage({
            threadId: eventInput.threadId,
            agentId: eventInput.agentId,
            usage: event.usage,
            nextEventId,
            onEvent: input.onEvent,
          });
          if (usage !== undefined) {
            await nativeRuntimeProjector.recordProjectedRuntimeStateBlocks(
              eventInput.threadId,
              nativeBlocks,
              new Set(["usage"]),
            );
          }
        }
        // Fan-out over — clear the live-activity count so it doesn't linger (Slice B).
        emitStructuredActivity({ threadId: eventInput.threadId, activity: {}, nextEventId, onEvent: input.onEvent });
        await nativeRuntimeProjector.recordProjectedRuntimeStateBlocks(
          eventInput.threadId,
          nativeBlocks,
          new Set(["agent_activity"]),
        );
        const current = service.peekThread(eventInput.threadId);
        const activeGoal = goalKeepsRuntimeBusy(current.ok ? current.thread.goalState : undefined);
        if (activeGoal) {
          await flushPersist(eventInput.threadId);
          return;
        }
        const nextBlocks = new Map(
          (blocksByThread.get(eventInput.threadId) ?? []).map((block) => [
            block.blockId,
            block,
          ]),
        );
        const outcome: AgentTurnOutcome =
          event.notice !== undefined
            ? { notice: { severity: "error", message: event.notice } }
            : {};
        await ingestTurnOutcomeAndSettle({
          outcome,
          threadId: eventInput.threadId,
          agentId: eventInput.agentId,
          runtimeId: eventInput.runtimeId,
          nextBlocks,
        });
        blocksByThread.set(eventInput.threadId, [...nextBlocks.values()]);
        return;
      }
      if (event.kind === "runtime_exited") {
        // A crash mid-turn must not strand the thread "Working": settle it.
        // (recordTurnComplete is a no-op when the thread is already idle.) The runtime
        // is genuinely gone, so force the settle even past an open prompt — that card
        // is now truly dead (its runtime can no longer receive the answer).
        await emitTurnComplete({
          threadId: eventInput.threadId,
          service,
          onEvent: input.onEvent,
          force: true,
        });
        await flushPersist(eventInput.threadId);
      }
      });
    },
    // Flush every pending debounced conversation-cache write immediately. Wired to
    // backend shutdown so a clean quit never loses the trailing debounce window.
    async flushPendingPersists(): Promise<void> {
      await flushAllPersists();
    },
  };
}

// On a turn-end signal, return the runtime to idle (so the UI stops showing
// "working") or flush a queued Composer input into the next turn.
async function emitTurnComplete(input: {
  threadId: string;
  service: ThreadRuntimeService;
  onEvent?: (event: BackendEventEnvelope) => void;
  // Settle even if the thread is still blocked on an unanswered prompt. Set ONLY for a
  // genuine runtime exit (the card is then truly dead). A turn-end NEVER forces — a
  // spurious/empty turn-end (or the AskUserQuestion text+question shape) must not drop a
  // live, never-answered card. An answered card settles via promptAnsweredPendingSettle.
  force?: boolean;
}): Promise<void> {
  const result = await input.service.recordTurnComplete({ threadId: input.threadId, force: input.force });
  if (!result.ok) {
    return;
  }
  // If a queued input was flushed into the next turn, surface its user-message
  // block so the conversation shows the queued message (then the new turn runs).
  if (result.submittedBlock !== undefined) {
    input.onEvent?.({
      contractVersion: CONTRACT_VERSION,
      eventId: nextEventId(),
      kind: "agentSessionBlock.upserted",
      emittedAt: new Date().toISOString(),
      payload: {
        block: toAgentSessionBlockDto(result.thread, result.submittedBlock),
      },
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

async function emitPromptState(input: {
  promptState?: PromptState;
  service: ThreadRuntimeService;
  onEvent?: (event: BackendEventEnvelope) => void;
}): Promise<void> {
  if (input.promptState === undefined) {
    return;
  }

  const result = await input.service.recordProviderPromptState({
    threadId: input.promptState.threadId,
    promptState: input.promptState,
  });
  if (!result.ok) {
    return;
  }

  input.onEvent?.({
    contractVersion: CONTRACT_VERSION,
    eventId: nextEventId(),
    kind: "prompt.changed",
    emittedAt: new Date().toISOString(),
    payload: {
      threadId: result.thread.threadId,
      prompt: result.promptState,
    },
  });
  // Announce the waiting state too: prompt.changed alone leaves a BACKGROUND
  // thread's rail row without its attention dot/notification (adversarial
  // review finding) — the rail listens to agentRuntime.stateChanged.
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

async function emitPromptWithdrawal(input: {
  threadId: string;
  promptId: string;
  service: ThreadRuntimeService;
  onEvent?: (event: BackendEventEnvelope) => void;
}): Promise<void> {
  const result = await input.service.withdrawProviderPrompt({
    threadId: input.threadId,
    promptId: input.promptId,
  });
  if (!result.ok) {
    return;
  }
  // Surface the prompt now visible after the withdrawal (a promoted queued card, or null
  // when the turn resumed) and the matching runtime state — same pair emitPromptState
  // sends, so the active chat AND the rail dot both reconcile deterministically.
  input.onEvent?.({
    contractVersion: CONTRACT_VERSION,
    eventId: nextEventId(),
    kind: "prompt.changed",
    emittedAt: new Date().toISOString(),
    payload: { threadId: result.thread.threadId, prompt: result.promptState },
  });
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

async function recordDiscoveredProviderSessionRef(input: {
  service: ThreadRuntimeService;
  persistence: ThreadPersistenceService;
  threadId: string;
  providerSessionRef: DiscoveredProviderSessionRef;
}): Promise<void> {
  const recorded = await input.service.recordProviderSessionRef({
    threadId: input.threadId,
    agentId: input.providerSessionRef.agentId,
    providerSessionRef: {
      kind: input.providerSessionRef.kind,
      value: input.providerSessionRef.value,
      transcriptPath: input.providerSessionRef.transcriptPath,
      logPath: input.providerSessionRef.logPath,
    },
  });
  if (!recorded.ok) {
    return;
  }

  const attached = recorded.thread.agentBinding.providerSessionRef;
  if (
    attached?.kind !== input.providerSessionRef.kind ||
    attached.value !== input.providerSessionRef.value ||
    attached.transcriptPath !== input.providerSessionRef.transcriptPath ||
    attached.logPath !== input.providerSessionRef.logPath
  ) {
    return;
  }

  const persisted = await input.persistence.attachProviderSessionRef(input.threadId, {
    ...input.providerSessionRef,
    observedAt: new Date().toISOString(),
  });
  if (!persisted.ok) {
    process.emitWarning(persisted.error.message, {
      type: "TideProviderSessionRefWarning",
    });
  }
}
