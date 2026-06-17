import { existsSync } from "node:fs";

import { createBackendContractMessageAdapter } from "../../../adapters/inbound/contract-message-adapter/contract-message-adapter.ts";
import { persistThreadBlocks } from "./live-projector.ts";
import { discoverAdoptedThreadSeeds, rebuildAdoptedConversation } from "./live-provider-discovery.ts";
import { rebuildConversationFromProviderHistory } from "../provider/provider-conversation-rebuilders.ts";
import { isInternalSessionTitle } from "../../../application/services/provider/provider-session-discovery.ts";
import type { AgentSessionBlock } from "../../../application/domains/agent-session/agent-session-block.ts";
import {
  THREAD_STORAGE_VERSION,
  type ThreadPersistenceService,
  type ThreadStorageRecord,
} from "../../../application/services/thread/thread-persistence-service.ts";
import type {
  ThreadSeed,
  ThreadRuntimeService,
} from "../../../application/services/thread/thread-runtime-service.ts";
import type {
  BackendEventEnvelope,
  ThreadSummaryDto,
} from "../../../../shared/contracts/index.ts";

// Persistence + restore collaborator extracted from live-backend.ts (the composition
// root). Owns: thread metadata-first restore with lazy per-thread block hydration and
// background adopted-session discovery, the post-command persistence of thread events,
// and the ThreadStorageRecord ⇄ ThreadSeed / ThreadSummaryDto mapping. Spec:
// docs_v2/specs/thread-list-metadata-first-restore.md and persistence.md.

export function createPersistentLiveBackendAdapter(input: {
  adapter: ReturnType<typeof createBackendContractMessageAdapter>;
  service: ThreadRuntimeService;
  persistence: ThreadPersistenceService;
  homeDir: string;
  appDataRoot: string;
  flushPendingPersists: () => Promise<void>;
  emitBackendEvents: (events: BackendEventEnvelope[]) => void;
}) {
  let restorePromise: Promise<void> | null = null;
  // Persisted records captured by the metadata restore, reused by the deferred
  // adopted-session discovery so it doesn't re-read them.
  let persistedRecords: ThreadStorageRecord[] = [];
  let adoptedDiscoveryKicked = false;
  // Per-thread lazy block loads, deduped so concurrent/repeat opens of one thread
  // share a single rebuild instead of racing.
  const lazyBlockLoads = new Map<string, Promise<void>>();

  // Phase 1 — gates the first thread.list (and so the Left Rail skeleton). Seeds
  // thread METADATA only: the per-thread conversation is rebuilt lazily when the
  // thread is first opened (ensureThreadBlocks), and adopted (external) sessions are
  // discovered off the critical path (phase 2). Boot latency therefore no longer
  // scales with thread count or local provider history.
  const restoreThreadMetadata = async (): Promise<void> => {
    // Guard the whole restore: this resolves the memoized restorePromise that EVERY
    // command awaits, so a thrown error must never reject it (that would fail the
    // first AND all subsequent commands, blocking the rail forever).
    try {
      const listed = await input.persistence.listThreadMetadata();
      if (!listed.ok) {
        process.emitWarning(listed.error.message, {
          type: "TidePersistenceRestoreWarning",
        });
        return;
      }
      // Drop auto-review / internal sub-sessions — they are not real conversations.
      persistedRecords = listed.value;
      const seeds = listed.value
        .map((record) => threadSeedFromStorageRecord(record))
        .filter((seed) => !isInternalSessionTitle(seed.title));
      const restored = await input.service.restoreThreads({ threads: seeds });
      if (!restored.ok) {
        process.emitWarning(restored.error.message, {
          type: "TidePersistenceRestoreWarning",
        });
      }
    } catch (error) {
      process.emitWarning(
        error instanceof Error ? error.message : "Thread metadata restore failed.",
        { type: "TidePersistenceRestoreWarning" },
      );
    }
  };

  // Phase 2 — background. Adopt provider sessions that exist in local history but were
  // started outside Tide. This walks the filesystem (provider rollouts/transcripts) and
  // runs SYNCHRONOUSLY, so the caller schedules it (setImmediate) only AFTER the first
  // response is computed — never gating the first list. When it finds new sessions it
  // PUSHES a refreshed thread.listed so they appear in the rail without a manual reload.
  const restoreAdoptedSessions = async (): Promise<void> => {
    try {
      const adopted = discoverAdoptedThreadSeeds({
        homeDir: input.homeDir,
        appDataRoot: input.appDataRoot,
        persistedRecords,
      }).filter((seed) => !isInternalSessionTitle(seed.title));
      for (const seed of adopted) {
        const blocks = rebuildAdoptedConversation(seed);
        if (blocks.length > 0) {
          seed.cachedBlocks = blocks;
        }
      }
      if (adopted.length === 0) {
        return;
      }
      const restored = await input.service.restoreThreads({ threads: adopted });
      if (restored.ok && restored.restoredCount > 0) {
        input.emitBackendEvents(await input.adapter.pushThreadListedEvents());
      }
    } catch (error) {
      process.emitWarning(
        error instanceof Error ? error.message : "Adopted session discovery failed.",
        { type: "TidePersistenceRestoreWarning" },
      );
    }
  };

  // Rebuild ONE thread's conversation the first time it is opened (its blocks were not
  // eagerly restored). Prefer the coding agent's own persisted session (codex rollout /
  // claude transcript); fall back to Tide's cached blocks. A thread whose worktree was
  // deleted gets the "tangled" banner. Cost is one file read + parse, paid inside the
  // existing thread-open hydrate loading window — invisible to the user.
  const loadThreadBlocks = async (threadId: string): Promise<void> => {
    const loaded = await input.persistence.loadThreadMetadata(threadId);
    if (!loaded.ok) {
      return;
    }
    const record = loaded.value;
    let blocks = rebuildConversationFromProviderHistory(record);
    if (blocks.length === 0) {
      const hydrated = await input.persistence.hydrateThread(threadId, {});
      if (hydrated.ok) {
        blocks = hydrated.value.blocks;
      }
    }
    const threadCwd = record.scope.kind === "project" ? record.scope.cwd : undefined;
    if (threadCwd !== undefined && !existsSync(threadCwd)) {
      blocks = [
        worktreeMissingBlock(record.threadId, record.agentBinding.agentId, threadCwd),
        ...blocks,
      ];
    }
    if (blocks.length > 0) {
      input.service.seedCachedBlocksIfEmpty(threadId, blocks);
    }
  };

  // Seed the opened thread's blocks (once) before the adapter hydrates it. A no-op for
  // any command that isn't a thread.hydrate, or for a thread already loaded.
  const ensureThreadBlocks = (message: unknown): Promise<void> => {
    const threadId = hydrateTargetThreadId(message);
    if (threadId === undefined) {
      return Promise.resolve();
    }
    let load = lazyBlockLoads.get(threadId);
    if (load === undefined) {
      // Drop a FAILED load from the cache so the next open can retry — a cached
      // rejected promise would otherwise make every subsequent open fail instantly.
      load = loadThreadBlocks(threadId).catch((error) => {
        lazyBlockLoads.delete(threadId);
        throw error;
      });
      lazyBlockLoads.set(threadId, load);
    }
    return load;
  };

  return {
    async handleMessage(message: unknown): Promise<BackendEventEnvelope[]> {
      restorePromise ??= restoreThreadMetadata();
      await restorePromise;
      // Fill the opened thread's conversation BEFORE the adapter hydrates it, so
      // thread.hydrated carries the real transcript and there is no empty flash.
      await ensureThreadBlocks(message);
      const events = await input.adapter.handleMessage(message);
      await persistThreadEvents(input.persistence, input.service, events);
      // Kick adopted (external) session discovery ONCE, after the first response is
      // computed. setImmediate fires in the next check phase — after this resolved
      // promise lets the entrypoint post the first thread.listed — so the rail clears
      // before the synchronous local-history scan blocks the loop.
      if (!adoptedDiscoveryKicked) {
        adoptedDiscoveryKicked = true;
        setImmediate(() => {
          void restoreAdoptedSessions();
        });
      }
      return events;
    },
    // Flush coalesced conversation-cache writes (wired to backend shutdown).
    flushPendingPersists: input.flushPendingPersists,
  };
}

// The thread a thread.hydrate command targets, if any — drives the lazy block load.
function hydrateTargetThreadId(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) {
    return undefined;
  }
  const envelope = message as { kind?: unknown; payload?: { threadId?: unknown } };
  if (envelope.kind !== "thread.hydrate") {
    return undefined;
  }
  return typeof envelope.payload?.threadId === "string"
    ? envelope.payload.threadId
    : undefined;
}

export async function persistThreadEvents(
  persistence: ThreadPersistenceService,
  service: ThreadRuntimeService,
  events: BackendEventEnvelope[],
): Promise<void> {
  // Guard the whole body: one call site fires this as `void persistThreadEvents(...)`,
  // so an unhandled rejection from a disk/service error could crash the backend.
  try {
    const blockThreadIds = new Set<string>();
    for (const event of events) {
      if (event.kind === "agentSessionBlock.upserted") {
        const blockThreadId = (event.payload as { block?: { threadId?: unknown } }).block?.threadId;
        if (typeof blockThreadId === "string") {
          blockThreadIds.add(blockThreadId);
        }
      }
      if (
        event.kind !== "thread.started" &&
        event.kind !== "thread.hydrated" &&
        event.kind !== "thread.archived" &&
        event.kind !== "thread.pinChanged" &&
        event.kind !== "thread.renamed" &&
        event.kind !== "thread.launchOptionsChanged"
      ) {
        continue;
      }
      const payload = event.payload as { thread?: ThreadSummaryDto };
      if (payload.thread === undefined) {
        continue;
      }
      // Preserve the persisted cache pointer + ref paths: this summary-derived record
      // doesn't model them, and a wholesale save would orphan the thread's
      // agent-session-cache (making a reopened thread look empty after restart).
      const saved = await persistence.saveThreadMetadataPreservingCache(
        threadStorageRecordFromThreadSummary(payload.thread),
      );
      if (!saved.ok) {
        process.emitWarning(saved.error.message, {
          type: "TidePersistenceSaveWarning",
        });
      }
    }
    for (const threadId of blockThreadIds) {
      await persistThreadBlocks({ persistence, service, threadId });
    }
  } catch (error) {
    process.emitWarning(
      error instanceof Error ? error.message : "Failed to persist thread events.",
      { type: "TidePersistenceSaveWarning" },
    );
  }
}

export function threadSeedFromStorageRecord(record: ThreadStorageRecord): ThreadSeed {
  const providerSessionRef = record.providerSessionRef;
  const lastKnownState =
    record.archived || record.lastKnownState === "archived"
      ? "archived"
      : record.lastKnownState === "running"
        ? "idle"
        : record.lastKnownState;

  return {
    threadId: record.threadId,
    title: record.title,
    agentBinding: {
      ...record.agentBinding,
      providerSessionRef:
        providerSessionRef === undefined
          ? record.agentBinding.providerSessionRef
          : {
              kind: providerSessionRef.kind,
              value: providerSessionRef.value,
              transcriptPath: providerSessionRef.transcriptPath,
              logPath: providerSessionRef.logPath,
            },
    },
    scope: { ...record.scope },
    launchOptions: cloneLaunchOptions(record.launchOptions),
    lifecycleState: record.archived ? "archived" : "open",
    runtimeState: "not_started",
    lastKnownState,
    // Carry the persisted pin through restore. Without this the restored thread is
    // unpinned in memory, and the next metadata event (e.g. opening it →
    // thread.hydrated) writes pinned=false back to disk, erasing the pin.
    pinned: record.pinned,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// A synthetic top-of-thread notice for a thread whose worktree/project directory
// no longer exists on disk (e.g. the worktree was deleted) — the "tangled" state.
function worktreeMissingBlock(
  threadId: string,
  agentId: AgentSessionBlock["agentId"],
  cwd: string,
): AgentSessionBlock {
  const now = new Date().toISOString();
  return {
    blockId: `worktree-missing:${threadId}`,
    threadId,
    agentId,
    kind: "error",
    role: "system",
    sourceFrameIds: [],
    status: "failed",
    title: "Worktree unavailable",
    body: `⚠ This thread's working directory is gone:\n\`${cwd}\`\n\nIts worktree was likely removed, so files and new runs can't be shown here. Re-create the worktree at that path, or start a new thread.`,
    createdAt: now,
    updatedAt: now,
  };
}

export function threadStorageRecordFromThreadSummary(
  thread: ThreadSummaryDto,
): ThreadStorageRecord {
  const providerSessionRef = thread.agentBinding.providerSessionRef;
  const cwd = thread.scope.kind === "project" ? thread.scope.cwd : thread.scope.scratchCwd;

  return {
    storageVersion: THREAD_STORAGE_VERSION,
    threadId: thread.threadId,
    title: thread.title,
    pinned: thread.pinned,
    archived: thread.archived,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    agentBinding: {
      agentId: thread.agentBinding.agentId,
      runtimeSource: thread.agentBinding.runtimeSource,
      providerSessionRef:
        providerSessionRef === undefined
          ? undefined
          : {
              kind: providerSessionRef.kind,
              value: providerSessionRef.value,
              transcriptPath: providerSessionRef.transcriptPath,
              logPath: providerSessionRef.logPath,
            },
    },
    scope: { ...thread.scope },
    launchOptions: cloneLaunchOptions(thread.launchOptions),
    executionContext: { cwd },
    providerSessionRef:
      providerSessionRef === undefined
        ? undefined
        : {
            agentId: thread.agentBinding.agentId,
            kind: providerSessionRef.kind,
            value: providerSessionRef.value,
            transcriptPath: providerSessionRef.transcriptPath,
            logPath: providerSessionRef.logPath,
            observedAt: thread.updatedAt,
          },
    lastKnownState: thread.archived ? "archived" : thread.lastKnownState,
  };
}

function cloneLaunchOptions(
  launchOptions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return launchOptions === undefined ? undefined : { ...launchOptions };
}
