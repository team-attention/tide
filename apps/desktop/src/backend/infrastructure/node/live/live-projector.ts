import type { ThreadPersistenceService } from "../../../application/services/thread/thread-persistence-service.ts";
import type { AgentIntegrationRegistry } from "../../../adapters/outbound/agent-runtime/runtime-ports/agent-integration-agent-runtime-port.ts";
import { createFixtureAgentSessionReader } from "../../../application/services/thread/fixture-agent-session-reader.ts";
import type { AgentSessionBlock, AgentSessionBlockUpdate } from "../../../application/domains/agent-session/agent-session-block.ts";
import type { AgentTurnOutcome } from "../../../application/ports/outbound/agent-integration-port.ts";
import type { RawAgentFrame } from "../../../application/services/thread/thread-runtime-service.ts";
import type { StructuredProviderEvent } from "../../../adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
import { createAgentSessionBlockCompletedEventFromUpdate, createAgentSessionBlockUpsertedEventFromBlock } from "../../../adapters/outbound/desktop-contract/agent-session-block-event-adapter.ts";
import type { PromptState } from "../../../application/domains/thread/thread.ts";
import type { DiscoveredProviderSessionRef } from "../provider/provider-session-ref.ts";
import type { ThreadRuntimeService } from "../../../application/services/thread/thread-runtime-service.ts";
import { CONTRACT_VERSION } from "../../../../shared/contracts/index.ts";
import type { BackendEventEnvelope, ProviderCliAgentId } from "../../../../shared/contracts/index.ts";
import { toAgentSessionBlockDto } from "../../../adapters/inbound/contract-message-adapter/dto/thread-dtos.ts";
// Extracted from live-backend.ts (spec: navigable-source-structure).

export function createLiveAgentSessionEventProjector(input: {
  service: () => ThreadRuntimeService;
  persistence: ThreadPersistenceService;
  onEvent?: (event: BackendEventEnvelope) => void;
  homeDir: string;
  integrations: AgentIntegrationRegistry;
}) {
  const reader = createFixtureAgentSessionReader();
  const blocksByThread = new Map<string, AgentSessionBlock[]>();

  // Conversation-cache persistence is COALESCED. A streaming turn produces many
  // content_record block updates; persisting the full conversation on each one is
  // O(messages) full-disk writes per turn (see docs perf E1). Instead we record
  // blocks in the service synchronously (authoritative, in-memory) and schedule a
  // trailing debounced disk write, with a hard flush at the durability-critical
  // moments: turn end, prompt open, runtime exit, and backend shutdown. The cache
  // is a best-effort restore optimization, so losing at most the last debounce
  // window of an INCOMPLETE turn on a hard kill is acceptable; every settled state
  // is always flushed. `TIDE_DEBUG_PERSIST=1` logs each actual write.
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

  // Last usage signature emitted per thread, so identical usage isn't re-emitted
  // on every history poll (the chip would otherwise churn every tick).

  // Reads a provider transcript, parses its last-known context/token usage, and
  // emits `agentRuntime.usageChanged` when it differs from the last emit. A no-op
  // when the transcript is missing or carries no usage yet.
  // Uniform turn settle. Every Agent Integration produces an AgentTurnOutcome from
  // its OWN signals (claude/codex hook payload, codex rollout
  // transcript); this shared path applies it identically — the provider-specific
  // "circus" lives in the adapters, not here. `finalMessage` becomes the agent
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

    // finalMessage is content ONLY for one-shot agents (gemini), whose single session
    // read has no competing streaming reader. claude/codex return no finalMessage from
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
    async ingestStructuredFrame(frameInput: {
      threadId: string;
      agentId: "openai_api";
      source: "structured_batch";
      sourceRef?: string;
      payloadKind: "json";
      payload: Record<string, unknown>;
      body: string;
    }): Promise<void> {
      return serializeIngest(frameInput.threadId, () => appendFrameAndEmit(frameInput));
    },
    // Normalized protocol events from a STRUCTURED provider runtime (the
    // runtime-event spine realized): content records flow through the same
    // frame→block reader as everything else; prompts/turn-ends/session-refs hit
    // the service directly. NO pollers exist for these runtimes — the protocol
    // pushes. See docs_v2/specs/structured-agent-runtime.md.
    async ingestStructuredProviderEvent(eventInput: {
      threadId: string;
      agentId: ProviderCliAgentId;
      runtimeId: string;
      event: StructuredProviderEvent;
    }): Promise<void> {
      return serializeIngest(eventInput.threadId, async () => {
      const service = input.service();
      const event = eventInput.event;
      if (event.kind === "session_ref") {
        await recordDiscoveredProviderSessionRef({
          service,
          persistence: input.persistence,
          threadId: eventInput.threadId,
          providerSessionRef: event.ref,
        });
        return;
      }
      if (event.kind === "content_record") {
        await appendFrameAndEmit({
          threadId: eventInput.threadId,
          agentId: eventInput.agentId,
          source: "provider_history",
          sourceRef: event.sourceRef,
          payloadKind: "provider_record",
          payload: event.payload,
          body: event.body,
        });
        return;
      }
      if (event.kind === "content_delta") {
        // Live streaming: upsert the block in the in-memory cache and emit the
        // UI event ONLY — no frame append, no reader, no persist (per-token disk
        // writes would blow the perf budget). The matching content_record
        // finalizes + persists the same blockId when the block completes.
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
          emitStructuredUsage({
            threadId: eventInput.threadId,
            usage: event.usage,
            onEvent: input.onEvent,
          });
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

// Token usage reported natively by a structured protocol turn (claude result
// modelUsage; codex thread/tokenUsage/updated; gemini _meta.quota).
function emitStructuredUsage(input: {
  threadId: string;
  usage: { inputTokens?: number; outputTokens?: number; contextWindow?: number; totalTokens?: number };
  onEvent?: (event: BackendEventEnvelope) => void;
}): void {
  const total = input.usage.totalTokens;
  if (total === undefined) {
    return;
  }
  input.onEvent?.({
    contractVersion: CONTRACT_VERSION,
    eventId: nextEventId(),
    kind: "agentRuntime.usageChanged",
    emittedAt: new Date().toISOString(),
    payload: {
      threadId: input.threadId,
      usage: {
        totalTokens: total,
        ...(input.usage.contextWindow !== undefined
          ? { contextWindow: input.usage.contextWindow }
          : {}),
      },
    },
  });
}

function emitBlockUpdate(input: {
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

// Record a block update in the service's authoritative in-memory state ONLY.
// Disk persistence is coalesced separately (schedulePersist/flushPersist in the
// projector) so a streaming turn doesn't rewrite the whole conversation per block.
async function recordBlockUpdateInService(
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

// Persist the thread's full current Agent Session block list so a restart can
// restore the conversation. Blocks live as references in the service; fill the
// required block fields to write the durable cache.
export async function persistThreadBlocks(input: {
  persistence: ThreadPersistenceService;
  service: ThreadRuntimeService;
  threadId: string;
}): Promise<void> {
  try {
    await persistThreadBlocksUnsafe(input);
  } catch (error) {
    // The Agent Session cache is a best-effort restore optimization — the live
    // service holds the authoritative blocks in memory and the next write persists
    // the full list again. A transient FS error (concurrent atomic-write rename
    // race, or teardown removing the dir mid-write) must never crash the backend.
    process.emitWarning(
      error instanceof Error ? error.message : String(error),
      { type: "TidePersistenceCacheWarning" },
    );
  }
}

async function persistThreadBlocksUnsafe(input: {
  persistence: ThreadPersistenceService;
  service: ThreadRuntimeService;
  threadId: string;
}): Promise<void> {
  const hydrated = input.service.peekThread(input.threadId);
  if (!hydrated.ok || hydrated.blocks.length === 0) {
    return;
  }
  const agentId = hydrated.thread.agentBinding.agentId;
  const blocks = hydrated.blocks.map((ref) => ({
    blockId: ref.blockId,
    threadId: input.threadId,
    agentId: ref.agentId ?? agentId,
    kind: ref.kind,
    role: ref.role ?? "runtime",
    sourceFrameIds: ref.sourceFrameIds ?? [],
    localProvenance: ref.localProvenance,
    status: ref.status,
    title: ref.title,
    body: ref.body,
    data: ref.data,
    rawFallback: ref.rawFallback,
    createdAt: ref.createdAt ?? ref.updatedAt,
    updatedAt: ref.updatedAt,
  })) as AgentSessionBlock[];
  const saved = await input.persistence.writeAgentSessionCache(input.threadId, {
    blocks,
    sourceFingerprint: `local:${blocks.length}:${blocks[blocks.length - 1]?.updatedAt ?? ""}`,
  });
  if (!saved.ok) {
    process.emitWarning(saved.error.message, { type: "TidePersistenceCacheWarning" });
  }
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

export function nextEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
